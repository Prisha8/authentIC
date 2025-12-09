"""
IC image preprocessing pipeline.

This wraps the standalone script from /Users/shnjnmkkr/Downloads/pipeline/pipeline.py
so it can be called as a reusable tool inside the backend workflow.

Steps:
1) Segment the IC with SAM and crop to the device body (ROI extraction).
2) Detect edges in the IC crop.
3) Extract top view using perspective transformation based on detected edges.
4) Detect the marking/text region with EasyOCR on the top view.
5) Deskew the text region and export horizontal 0° and 180° variants.
6) Save a visualization of detected text boxes plus the cropped IC.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Optional

import cv2
import numpy as np
from PIL import Image
from ultralytics import SAM
import easyocr

DEFAULT_SAM_MODEL = (
    os.getenv("SAM21_MODEL_PATH")
    or os.getenv("SAM_MODEL_PATH")
    or str(Path(__file__).parent.parent / "weights" / "sam2.1_b.pt")
)

# EasyOCR model storage directory
EASYOCR_MODEL_DIR = Path(__file__).parent.parent / "weights" / "easyocr_models"
EASYOCR_MODEL_DIR.mkdir(parents=True, exist_ok=True)


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def detect_ic(image_path: str, sam_model_path: str = DEFAULT_SAM_MODEL) -> Optional[np.ndarray]:
    """Detect and crop the IC from the input image using SAM segmentation."""
    model = SAM(sam_model_path)
    results = model(image_path)

    if not results or not results[0].masks:
        return None

    masks = results[0].masks.data.cpu().numpy()
    img = cv2.imread(image_path)
    h, w, _ = img.shape
    best_mask = None
    max_area = 0

    # Find the best mask (largest reasonable area)
    for mask in masks:
        if mask.shape != (h, w):
            mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
        area = np.sum(mask)
        if area < 0.05 * h * w or area > 0.95 * h * w:
            continue
        if area > max_area:
            max_area = area
            best_mask = mask.astype(np.uint8)

    if best_mask is None:
        if len(masks) > 0:
            best_mask = masks[0].astype(np.uint8)
            if best_mask.shape != (h, w):
                best_mask = cv2.resize(best_mask, (w, h), interpolation=cv2.INTER_NEAREST)
        else:
            return None

    y_indices, x_indices = np.where(best_mask > 0)
    y_min, y_max = np.min(y_indices), np.max(y_indices)
    x_min, x_max = np.min(x_indices), np.max(x_indices)

    ic_crop = img[y_min:y_max, x_min:x_max]
    return ic_crop


def detect_edges(ic_image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Detect edges in the IC image using Canny edge detection.
    Returns:
        edges: Binary edge map (np.ndarray)
        edges_visualization: Color visualization of edges (np.ndarray)
    """
    gray = cv2.cvtColor(ic_image, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Canny edge detection with adaptive thresholds
    # Use median of image to set thresholds
    median_val = np.median(blurred)
    lower_threshold = int(max(0, 0.7 * median_val))
    upper_threshold = int(min(255, 1.3 * median_val))
    
    edges = cv2.Canny(blurred, lower_threshold, upper_threshold)
    
    # Create visualization (edges in green on original image)
    edges_viz = ic_image.copy()
    edges_viz[edges > 0] = [0, 255, 0]  # Green edges
    
    return edges, edges_viz


def extract_top_view(ic_image: np.ndarray, edges: np.ndarray) -> tuple[np.ndarray, Optional[np.ndarray]]:
    """
    Extract top view of the IC using perspective transformation.
    Uses detected edges to find the IC body corners.
    Since SAM already crops the IC body, this mainly corrects for perspective skew.
    
    Returns:
        top_view: Top-down view of the IC (np.ndarray)
        corners_viz: Visualization with detected corners (np.ndarray) or None
    """
    gray = cv2.cvtColor(ic_image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    
    # Find contours from edges
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        # If no contours found, return original image (already a top view from SAM crop)
        return ic_image, None
    
    # Filter contours to find the IC body (should be large, covering significant portion of image)
    # The IC body should be at least 40% of the image area to avoid small text regions
    min_area = 0.40 * h * w
    large_contours = [c for c in contours if cv2.contourArea(c) >= min_area]
    
    if not large_contours:
        # If no large contours found, the IC crop is already a good top view
        # Return it as-is (SAM already gave us a top view)
        return ic_image, None
    
    # Use the largest of the large contours (should be the IC body)
    largest_contour = max(large_contours, key=cv2.contourArea)
    
    # Get the minimum area rotated rectangle (handles rotation better)
    rect = cv2.minAreaRect(largest_contour)
    box = cv2.boxPoints(rect)
    box = np.float32(box)
    
    # Get bounding rectangle for size calculation
    x, y, bw, bh = cv2.boundingRect(largest_contour)
    
    # Check if the detected rectangle is reasonable (at least 50% of image size)
    if bw < 0.5 * w or bh < 0.5 * h:
        # Rectangle too small, return original image
        return ic_image, None
    
    # Order corners: top-left, top-right, bottom-right, bottom-left
    def order_points(pts):
        rect = np.zeros((4, 2), dtype="float32")
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]  # top-left
        rect[2] = pts[np.argmax(s)]  # bottom-right
        
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]  # top-right
        rect[3] = pts[np.argmax(diff)]  # bottom-left
        return rect
    
    ordered_corners = order_points(box)
    
    # Calculate dimensions for output using the rotated rectangle dimensions
    width = int(rect[1][0])
    height = int(rect[1][1])
    
    # Ensure width >= height (landscape orientation)
    if width < height:
        width, height = height, width
    
    # Destination points for perspective transform
    dst = np.array([
        [0, 0],
        [width - 1, 0],
        [width - 1, height - 1],
        [0, height - 1]
    ], dtype="float32")
    
    # Compute perspective transform matrix
    M = cv2.getPerspectiveTransform(ordered_corners, dst)
    
    # Apply perspective transform
    top_view = cv2.warpPerspective(ic_image, M, (width, height))
    
    # Create visualization with corners
    corners_viz = ic_image.copy()
    corners_int = box.astype(np.int32)
    
    # Draw corners
    for i, corner in enumerate(corners_int):
        cv2.circle(corners_viz, tuple(corner), 10, (0, 0, 255), -1)
        cv2.putText(corners_viz, str(i), tuple(corner), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    
    # Draw rectangle connecting corners
    cv2.polylines(corners_viz, [corners_int], True, (255, 0, 0), 3)
    
    return top_view, corners_viz


def _get_easyocr_reader():
    """
    Initialize EasyOCR reader with local model storage.
    Returns a cached reader instance to avoid reinitializing.
    SSL context is already fixed at module level.
    """
    # Use a module-level cache to avoid reinitializing
    if not hasattr(_get_easyocr_reader, '_cached_reader'):
        try:
            # Initialize EasyOCR with local model directory
            # SSL context is already configured at module level
            try:
                reader = easyocr.Reader(
                    ["en"], 
                    gpu=True,
                    model_storage_directory=str(EASYOCR_MODEL_DIR),
                    download_enabled=True
                )
            except Exception as gpu_error:
                print(f"GPU initialization failed, trying CPU: {gpu_error}")
                reader = easyocr.Reader(
                    ["en"], 
                    gpu=False,
                    model_storage_directory=str(EASYOCR_MODEL_DIR),
                    download_enabled=True
                )
            
            _get_easyocr_reader._cached_reader = reader
            print("EasyOCR reader initialized successfully")
        except Exception as e:
            print(f"Error initializing EasyOCR: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    return _get_easyocr_reader._cached_reader


def detect_textbox(ic_image: np.ndarray) -> tuple[np.ndarray, np.ndarray, Optional[tuple]]:
    """
    Detect the marking/text region within the IC using EasyOCR and return a deskewed crop.
    Returns:
        textbox_crop: Straightened text region (np.ndarray)
        bbox_viz: IC image annotated with detected boxes
        rect: Rotated rectangle for debugging (center, size, angle)
    """
    reader = _get_easyocr_reader()
    results = reader.readtext(ic_image)

    bbox_viz = ic_image.copy()
    if not results:
        return ic_image, bbox_viz, None

    all_points = []
    for (bbox, text, prob) in results:
        pts = np.array(bbox, dtype=np.int32)
        cv2.polylines(bbox_viz, [pts], isClosed=True, color=(0, 255, 0), thickness=2)
        cv2.putText(
            bbox_viz,
            f"{text} ({prob:.2f})",
            (int(bbox[0][0]), int(bbox[0][1]) - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (0, 255, 0),
            1,
        )
        for pt in bbox:
            all_points.append(pt)

    if not all_points:
        return ic_image, bbox_viz, None

    all_points = np.array(all_points, dtype=np.int32)
    rect = cv2.minAreaRect(all_points)

    box = cv2.boxPoints(rect)
    box = np.int32(box)
    cv2.drawContours(bbox_viz, [box], 0, (0, 0, 255), 2)

    center, size, angle = rect
    center, size = tuple(map(int, center)), tuple(map(int, size))

    w, h = size
    padding = 10
    size = (w + padding * 2, h + padding * 2)

    ic_h, ic_w = ic_image.shape[:2]
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    img_rot = cv2.warpAffine(ic_image, M, (ic_w, ic_h))
    img_crop = cv2.getRectSubPix(img_rot, size, center)

    if img_crop.shape[0] > img_crop.shape[1]:
        img_crop = cv2.rotate(img_crop, cv2.ROTATE_90_CLOCKWISE)

    return img_crop, bbox_viz, rect


def save_outputs(
    straightened_image: np.ndarray,
    bbox_viz: np.ndarray,
    ic_crop: np.ndarray,
    output_dir: Path,
    edges_viz: Optional[np.ndarray] = None,
    top_view: Optional[np.ndarray] = None,
    corners_viz: Optional[np.ndarray] = None,
) -> Dict[str, str]:
    """Persist all outputs and return their paths."""
    output_dir = _ensure_dir(output_dir)

    path_0 = output_dir / "output_horizontal_0.jpg"
    cv2.imwrite(str(path_0), straightened_image)

    img_180 = cv2.rotate(straightened_image, cv2.ROTATE_180)
    path_180 = output_dir / "output_horizontal_180.jpg"
    cv2.imwrite(str(path_180), img_180)

    path_bbox = output_dir / "output_textbox_visualization.jpg"
    cv2.imwrite(str(path_bbox), bbox_viz)

    path_ic = output_dir / "output_ic_crop.jpg"
    cv2.imwrite(str(path_ic), ic_crop)
    
    outputs = {
        "output_0_deg": str(path_0),
        "output_180_deg": str(path_180),
        "output_textbox_viz": str(path_bbox),
        "ic_crop": str(path_ic),
    }
    
    # Save edge detection visualization if available
    if edges_viz is not None:
        path_edges = output_dir / "output_edges_visualization.jpg"
        cv2.imwrite(str(path_edges), edges_viz)
        outputs["edges_viz"] = str(path_edges)
    
    # Save top view if available
    if top_view is not None:
        path_top_view = output_dir / "output_top_view.jpg"
        cv2.imwrite(str(path_top_view), top_view)
        outputs["top_view"] = str(path_top_view)
    
    # Save corners visualization if available
    if corners_viz is not None:
        path_corners = output_dir / "output_corners_visualization.jpg"
        cv2.imwrite(str(path_corners), corners_viz)
        outputs["corners_viz"] = str(path_corners)

    return outputs


def run_preprocessing(
    image_path: str,
    output_dir: str,
    sam_model_path: str = DEFAULT_SAM_MODEL,
    enable_edge_detection: bool = True,
    enable_top_view: bool = True,
) -> Optional[Dict[str, str]]:
    """
    Run the preprocessing pipeline and return paths to generated assets.
    
    Pipeline steps:
    1. Get ROIs (segment IC with SAM)
    2. Detect edges
    3. Extract top view (perspective transform)
    4. Run OCR on top view

    Args:
        image_path: Path to input image
        output_dir: Directory to save outputs
        sam_model_path: Path to SAM model weights
        enable_edge_detection: Enable edge detection step
        enable_top_view: Enable top view extraction step

    Returns None on failure.
    """
    image_path = str(image_path)
    if not Path(image_path).exists():
        return None

    output_dir_path = _ensure_dir(Path(output_dir))
    
    # Step 1: Get ROIs (segment IC)
    ic_crop = detect_ic(image_path, sam_model_path=sam_model_path)
    if ic_crop is None:
        return None
    
    edges_viz = None
    top_view = None
    corners_viz = None
    
    # Step 2: Detect edges
    if enable_edge_detection:
        edges, edges_viz = detect_edges(ic_crop)
        
        # Step 3: Extract top view
        if enable_top_view:
            top_view, corners_viz = extract_top_view(ic_crop, edges)
            # Use top view for OCR if available
            ocr_input = top_view
        else:
            ocr_input = ic_crop
    else:
        ocr_input = ic_crop
    
    # Step 4: Run OCR on the processed image
    straightened, bbox_viz, _ = detect_textbox(ocr_input)
    straightened = straightened if straightened is not None else ocr_input

    return save_outputs(
        straightened, 
        bbox_viz, 
        ic_crop, 
        output_dir_path,
        edges_viz=edges_viz,
        top_view=top_view,
        corners_viz=corners_viz
    )


__all__ = ["run_preprocessing"]

