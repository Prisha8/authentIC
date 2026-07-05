"""
IC Image Processing Pipeline

Input: Top-view IC image path
Output: Two straightened images:
    - output_horizontal_0.jpg (0 degree)
    - output_horizontal_180.jpg (180 degree rotated)

Pipeline Steps:
1. Detect and segment IC using SAM
2. Detect text region using EasyOCR
3. Straighten the text region horizontally
4. Generate both 0° and 180° rotated versions
"""

import cv2
import numpy as np
import os
import sys
import argparse
from ultralytics import SAM
from PIL import Image
import easyocr

# Model caches so warm processes (GPU worker containers) load weights only once
_SAM_MODELS = {}
_EASYOCR_READER = None


def _get_sam_model(sam_model_path):
    if sam_model_path not in _SAM_MODELS:
        _SAM_MODELS[sam_model_path] = SAM(sam_model_path)
    return _SAM_MODELS[sam_model_path]


def _get_easyocr_reader():
    """EasyOCR reader with GPU auto-detection and optional pre-baked model dir.

    Env:
        EASYOCR_GPU: 'true'/'false' to force; default = torch.cuda.is_available()
        EASYOCR_MODEL_DIR: directory with craft/english weights (skips download)
    """
    global _EASYOCR_READER
    if _EASYOCR_READER is None:
        gpu_env = os.getenv("EASYOCR_GPU", "").strip().lower()
        if gpu_env in ("true", "1", "yes"):
            use_gpu = True
        elif gpu_env in ("false", "0", "no"):
            use_gpu = False
        else:
            try:
                import torch
                use_gpu = torch.cuda.is_available()
            except ImportError:
                use_gpu = False
        model_dir = os.getenv("EASYOCR_MODEL_DIR") or None
        kwargs = {"gpu": use_gpu}
        if model_dir:
            kwargs["model_storage_directory"] = model_dir
            kwargs["download_enabled"] = False
        _EASYOCR_READER = easyocr.Reader(['en'], **kwargs)
    return _EASYOCR_READER


def detect_ic(image_path, sam_model_path="sam2.1_b.pt"):
    """
    Detect and crop the IC from the input image using SAM segmentation.
    
    Args:
        image_path: Path to the input IC image
        sam_model_path: Path to the SAM model weights
        
    Returns:
        ic_crop: Cropped IC region as numpy array, or None if detection fails
    """
    print(f"[Step 1] Loading SAM model...")
    model = _get_sam_model(sam_model_path)
    
    print(f"[Step 1] Segmenting IC from {image_path}...")
    results = model(image_path)
    
    if not results or not results[0].masks:
        print("[Step 1] ERROR: No masks found by SAM.")
        return None

    masks = results[0].masks.data.cpu().numpy()
    img = cv2.imread(image_path)
    h, w, _ = img.shape
    best_mask = None
    max_area = 0
    
    # Find the best mask (largest area within reasonable bounds)
    for mask in masks:
        if mask.shape != (h, w):
            mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
        area = np.sum(mask)
        # Filter masks that are too small or too large
        if area < 0.05 * h * w or area > 0.95 * h * w:
            continue
        if area > max_area:
            max_area = area
            best_mask = mask.astype(np.uint8)

    if best_mask is None:
        print("[Step 1] WARNING: Could not find a suitable IC mask. Using first mask.")
        if len(masks) > 0:
            best_mask = masks[0].astype(np.uint8)
            if best_mask.shape != (h, w):
                best_mask = cv2.resize(best_mask, (w, h), interpolation=cv2.INTER_NEAREST)
        else:
            return None

    # Crop to bounding box of the mask
    y_indices, x_indices = np.where(best_mask > 0)
    y_min, y_max = np.min(y_indices), np.max(y_indices)
    x_min, x_max = np.min(x_indices), np.max(x_indices)

    ic_crop = img[y_min:y_max, x_min:x_max]
    print(f"[Step 1] IC detected and cropped. Size: {ic_crop.shape}")
    return ic_crop


def detect_textbox(ic_image):
    """
    Detect the text region within the IC using EasyOCR and crop it.
    
    Args:
        ic_image: Cropped IC image as numpy array
        
    Returns:
        textbox_crop: Straightened text region as numpy array
        bbox_viz: Image with bounding boxes drawn over detected text
        rect: The detected rotated rectangle (for debugging)
    """
    print("[Step 2] Detecting text region using EasyOCR...")
    reader = _get_easyocr_reader()
    results = reader.readtext(ic_image)
    
    # Create visualization image with bounding boxes
    bbox_viz = ic_image.copy()
    
    if not results:
        print("[Step 2] WARNING: EasyOCR found no text. Returning full IC crop.")
        return ic_image, bbox_viz, None

    # Collect all text bounding box points and draw boxes
    all_points = []
    for (bbox, text, prob) in results:
        # Draw individual text bounding box
        pts = np.array(bbox, dtype=np.int32)
        cv2.polylines(bbox_viz, [pts], isClosed=True, color=(0, 255, 0), thickness=2)
        # Add text label
        cv2.putText(bbox_viz, f"{text} ({prob:.2f})", 
                    (int(bbox[0][0]), int(bbox[0][1]) - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
        for pt in bbox:
            all_points.append(pt)
            
    if not all_points:
        return ic_image, bbox_viz, None

    # Find the minimum area rotated rectangle enclosing all text
    all_points = np.array(all_points, dtype=np.int32)
    rect = cv2.minAreaRect(all_points)
    
    # Draw the overall text region rectangle
    box = cv2.boxPoints(rect)
    box = np.int32(box)
    cv2.drawContours(bbox_viz, [box], 0, (0, 0, 255), 2)
    
    center, size, angle = rect
    center, size = tuple(map(int, center)), tuple(map(int, size))
    
    # Add padding around the text region
    w, h = size
    padding = 10
    size = (w + padding * 2, h + padding * 2)
    
    # Rotate and crop the text region
    ic_h, ic_w = ic_image.shape[:2]
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    img_rot = cv2.warpAffine(ic_image, M, (ic_w, ic_h))
    img_crop = cv2.getRectSubPix(img_rot, size, center)
    
    # Ensure the crop is horizontal (width > height)
    if img_crop.shape[0] > img_crop.shape[1]:
        img_crop = cv2.rotate(img_crop, cv2.ROTATE_90_CLOCKWISE)
        
    print(f"[Step 2] Text region detected and straightened. Size: {img_crop.shape}")
    print(f"[Step 2] Found {len(results)} text regions.")
    return img_crop, bbox_viz, rect


def save_outputs(straightened_image, bbox_viz, output_dir, ic_crop=None):
    """
    Save all output images: 0°, 180° rotated, textbox visualization, and IC crop.
    
    Args:
        straightened_image: The straightened text region
        bbox_viz: Image with bounding boxes drawn
        output_dir: Directory to save output images
        ic_crop: The full IC crop from SAM segmentation (before text detection)
        
    Returns:
        Dictionary with paths to all output images
    """
    print("[Step 3] Saving output images...")
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Save full IC crop from SAM (before EasyOCR)
    path_ic_crop = os.path.join(output_dir, "output_ic_crop.jpg")
    if ic_crop is not None:
        cv2.imwrite(path_ic_crop, ic_crop)
        print(f"[Step 3] Saved: {path_ic_crop}")
    
    # 0 degree version
    path_0 = os.path.join(output_dir, "output_horizontal_0.jpg")
    cv2.imwrite(path_0, straightened_image)
    print(f"[Step 3] Saved: {path_0}")
    
    # 180 degree rotated version
    img_180 = cv2.rotate(straightened_image, cv2.ROTATE_180)
    path_180 = os.path.join(output_dir, "output_horizontal_180.jpg")
    cv2.imwrite(path_180, img_180)
    print(f"[Step 3] Saved: {path_180}")
    
    # Textbox visualization
    path_bbox = os.path.join(output_dir, "output_textbox_visualization.jpg")
    cv2.imwrite(path_bbox, bbox_viz)
    print(f"[Step 3] Saved: {path_bbox}")
    
    return {
        "output_ic_crop": path_ic_crop,
        "output_0_deg": path_0,
        "output_180_deg": path_180,
        "output_textbox_viz": path_bbox
    }


def run_pipeline(image_path, output_dir="output", sam_model_path="sam2.1_b.pt"):
    """
    Run the complete IC processing pipeline.
    
    Args:
        image_path: Path to the input IC image
        output_dir: Directory to save output images
        sam_model_path: Path to SAM model weights
        
    Returns:
        Dictionary with paths to output images, or None on failure
    """
    print("=" * 50)
    print("IC IMAGE PROCESSING PIPELINE")
    print("=" * 50)
    print(f"Input: {image_path}")
    print(f"Output Directory: {output_dir}")
    print("=" * 50)
    
    # Validate input
    if not os.path.exists(image_path):
        print(f"ERROR: Image not found: {image_path}")
        return None
        
    # Step 1: Detect IC
    ic_crop = detect_ic(image_path, sam_model_path)
    if ic_crop is None:
        print("ERROR: IC detection failed.")
        return None
    
    # Step 2: Detect and straighten text region
    straightened, bbox_viz, rect = detect_textbox(ic_crop)
    if straightened is None:
        straightened = ic_crop  # Fallback to full IC crop
    
    # Step 3: Save all outputs (including the full IC crop)
    outputs = save_outputs(straightened, bbox_viz, output_dir, ic_crop)
    
    print("=" * 50)
    print("PIPELINE COMPLETE")
    print("=" * 50)
    
    return {
        "input": image_path,
        **outputs
    }


def main():
    parser = argparse.ArgumentParser(
        description="IC Image Processing Pipeline - Detects IC, straightens text, outputs 0° and 180° versions."
    )
    parser.add_argument(
        "image_path", 
        help="Path to the input IC image (top view)"
    )
    parser.add_argument(
        "--output_dir", 
        default="output",
        help="Directory to save output images (default: output)"
    )
    parser.add_argument(
        "--sam_model", 
        default="sam2.1_b.pt",
        help="Path to SAM model weights (default: sam2.1_b.pt)"
    )
    
    args = parser.parse_args()
    
    result = run_pipeline(
        image_path=args.image_path,
        output_dir=args.output_dir,
        sam_model_path=args.sam_model
    )
    
    if result:
        print("\nOutput files:")
        print(f"  IC Crop:   {result['output_ic_crop']}")
        print(f"  0°:        {result['output_0_deg']}")
        print(f"  180°:      {result['output_180_deg']}")
        print(f"  Textboxes: {result['output_textbox_viz']}")
    else:
        print("\nPipeline failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
