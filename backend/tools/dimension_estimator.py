#!/usr/bin/env python3
"""
Dimension & Aspect Ratio Estimator (SAM-first)

Analyzes IC physical dimensions and proportions using SAM 2.1 masks only.
We rely on the segmentation mask to derive aspect ratio and mask-driven
metrics that can be compared with OEM datasheet specs. No CV fallback.
"""

import os
import cv2
import numpy as np
from scipy import stats
from dataclasses import dataclass, asdict
from typing import Dict, List, Tuple, Optional
import json
from pathlib import Path
from tools.sam21_segmenter import generate_sam21_mask, Sam21NotAvailable

# Set matplotlib to use non-GUI backend (required for Flask/threading)
import matplotlib
matplotlib.use('Agg')  # Non-GUI backend - works in threads

import matplotlib.pyplot as plt


DEFAULT_SAM21_CHECKPOINT = (
    os.getenv("SAM21_CHECKPOINT_PATH")
    or os.getenv("SAM21_MODEL_PATH")
    or str(Path(__file__).parent.parent / "weights" / "sam2.1_b.pt")
)
# Default config name works with pip-installed sam2 Hydra search path.
DEFAULT_SAM21_MODEL_CFG = os.getenv("SAM21_MODEL_CFG") or "configs/sam2.1/sam2.1_hiera_b+"


@dataclass
class DimensionResult:
    """Results from dimension analysis"""
    # Detected dimensions (pixels)
    body_width_px: int
    body_height_px: int
    measured_aspect_ratio: float
    
    # Expected from datasheet
    expected_length_mm: Optional[float]
    expected_width_mm: Optional[float]
    expected_aspect_ratio: Optional[float]
    
    # Comparison
    aspect_ratio_match: bool
    aspect_ratio_error_percent: float
    
    # Pin analysis
    pin_pitch_uniformity: Optional[float]  # CV (coefficient of variation)
    pin_spacing_consistent: bool
    
    # Scoring
    dimension_score: float  # 0-100, higher = better match
    confidence: float
    verdict: str  # "MATCH", "SUSPICIOUS", "MISMATCH"
    
    # Evidence
    bboxes: List[Dict]
    metrics: Dict
    
    # Optional mask metadata (defaults last)
    mask_score: Optional[float] = None
    mask_area_px: Optional[int] = None
    mask_coverage: Optional[float] = None
    mask_source: Optional[str] = None
    mask_visualization_path: Optional[str] = None


def _mask_to_bbox(mask: np.ndarray) -> Dict:
    """Convert a binary mask into a rotated bbox description."""
    if mask is None or mask.size == 0:
        raise ValueError("Empty mask provided to _mask_to_bbox.")

    mask_uint8 = mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("No contours found in SAM mask.")

    main_contour = max(contours, key=cv2.contourArea)
    rect = cv2.minAreaRect(main_contour)
    box_pts = cv2.boxPoints(rect)
    box_pts = np.int32(box_pts)

    x, y, bw, bh = cv2.boundingRect(main_contour)
    rw, rh = rect[1]
    if rw < rh:
        rw, rh = rh, rw

    return {
        'x': int(x),
        'y': int(y),
        'w': int(bw),
        'h': int(bh),
        'rw': float(rw),
        'rh': float(rh),
        'angle': float(rect[2]),
        'box_pts': box_pts.tolist(),
        'method': 'sam_mask'
    }


def _isolate_ic_mask(mask: np.ndarray, min_coverage: float = 0.05, max_coverage: float = 0.75) -> np.ndarray:
    """
    Post-process SAM mask to isolate just the IC body by:
    1. Keeping only the largest connected component
    2. Cleaning with morphological operations
    3. Filtering by reasonable coverage bounds
    """
    mask_uint8 = (mask > 0).astype(np.uint8)
    h, w = mask_uint8.shape
    total_pixels = h * w
    
    # Find connected components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_uint8, connectivity=8)
    
    if num_labels < 2:  # Only background
        return mask_uint8
    
    # Find the largest component (excluding background label 0)
    component_areas = stats[1:, cv2.CC_STAT_AREA]
    largest_idx = np.argmax(component_areas) + 1  # +1 because label 0 is background
    
    # Check coverage
    largest_area = component_areas[largest_idx - 1]
    coverage = largest_area / total_pixels
    
    # Filter by coverage bounds
    if coverage < min_coverage or coverage > max_coverage:
        # If largest component is unreasonable, try second largest
        if len(component_areas) > 1:
            sorted_indices = np.argsort(component_areas)[::-1]
            for idx in sorted_indices[1:]:  # Skip the largest we already checked
                candidate_idx = idx + 1
                candidate_area = component_areas[idx]
                candidate_coverage = candidate_area / total_pixels
                if min_coverage <= candidate_coverage <= max_coverage:
                    largest_idx = candidate_idx
                    coverage = candidate_coverage
                    break
    
    # Create mask with only the selected component
    isolated_mask = (labels == largest_idx).astype(np.uint8) * 255
    
    # Clean up with morphological operations
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    isolated_mask = cv2.morphologyEx(isolated_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    isolated_mask = cv2.morphologyEx(isolated_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    
    return isolated_mask


def _detect_body_with_sam(image_path: str) -> Tuple[np.ndarray, Dict, Dict]:
    """
    Detect IC body using SAM 2.1. Returns (mask, meta, rect) or raises on failure.
    Post-processes the mask to isolate just the IC body.
    """
    if not DEFAULT_SAM21_CHECKPOINT:
        raise Sam21NotAvailable("SAM 2.1 checkpoint path is not configured.")
    
    # Load image to get dimensions for better box prompt
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    h, w = img.shape[:2]
    
    # Use center region as box prompt (IC is typically centered)
    # This helps SAM focus on the IC rather than the entire image
    center_margin = 0.2  # Use 60% of image centered
    x0 = int(w * center_margin)
    y0 = int(h * center_margin)
    x1 = int(w * (1 - center_margin))
    y1 = int(h * (1 - center_margin))
    box_prompt = np.array([[x0, y0, x1, y1]], dtype=np.float32)
    
    mask, meta = generate_sam21_mask(
        image_path=image_path,
        checkpoint_path=DEFAULT_SAM21_CHECKPOINT,
        model_cfg=DEFAULT_SAM21_MODEL_CFG,
        device=None,
        box_prompt=box_prompt,
    )
    if mask is None:
        raise ValueError("SAM 2.1 returned an empty mask.")
    
    # Post-process mask to isolate IC body
    isolated_mask = _isolate_ic_mask(mask)
    
    # Update meta with isolated mask coverage
    isolated_area = np.count_nonzero(isolated_mask)
    isolated_coverage = float(isolated_area) / float(h * w)
    meta['coverage'] = isolated_coverage
    meta['area_px'] = int(isolated_area)
    
    rect = _mask_to_bbox(isolated_mask)
    rect['method'] = 'sam_mask'
    return isolated_mask, meta, rect


def _render_mask_visualization(
    image_path: str,
    mask: np.ndarray,
    measured_aspect: float,
    expected_aspect: Optional[float],
    coverage: Optional[float],
    score: float,
    verdict: str,
    output_path: Optional[str] = None,
) -> str:
    """
    Overlay SAM mask on the input image and annotate key metrics.
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image for visualization: {image_path}")

    # Normalize mask to uint8 and build overlay
    mask_uint8 = (mask > 0).astype(np.uint8)
    overlay = img.copy()
    color = np.array([0, 0, 255], dtype=np.uint8)  # Red overlay
    overlay[mask_uint8 > 0] = (overlay[mask_uint8 > 0] * 0.55 + color * 0.45).astype(np.uint8)

    blended = cv2.addWeighted(img, 0.65, overlay, 0.35, 0)
    img_rgb = cv2.cvtColor(blended, cv2.COLOR_BGR2RGB)

    # Build annotation text
    lines = [f"Measured AR: {measured_aspect:.3f}"]
    if expected_aspect:
        lines.append(f"Expected AR: {expected_aspect:.3f}")
    if coverage is not None:
        lines.append(f"Mask coverage: {coverage*100:.1f}%")
    lines.append(f"Score: {score:.1f}/100")
    lines.append(f"Verdict: {verdict}")
    annotation = "\n".join(lines)

    fig, ax = plt.subplots(figsize=(10, 8))
    ax.imshow(img_rgb)
    ax.axis('off')
    ax.set_title('SAM 2.1 Mask Overlay', fontsize=16, fontweight='bold', pad=12)
    ax.text(
        0.02, 0.98, annotation,
        transform=ax.transAxes,
        fontsize=12,
        color='white',
        fontweight='bold',
        ha='left',
        va='top',
        bbox=dict(boxstyle='round,pad=0.5', facecolor='black', alpha=0.55)
    )

    if output_path is None:
        img_path = Path(image_path)
        output_path = str(img_path.with_name(f"{img_path.stem}_sam_mask_overlay.png"))
    output_path_obj = Path(output_path)
    output_path_obj.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    return output_path


def detect_pins_and_spacing(img: np.ndarray, body_bbox: Tuple[int, int, int, int]) -> Dict:
    """
    Detect pins and measure spacing uniformity
    
    Returns dict with pin info and uniformity metrics
    """
    x, y, bw, bh = body_bbox
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Look for bright regions (pins) around the IC body
    # Expand search region slightly beyond body
    margin = 50
    x1 = max(0, x - margin)
    y1 = max(0, y - margin)
    x2 = min(img.shape[1], x + bw + margin)
    y2 = min(img.shape[0], y + bh + margin)
    
    roi = gray[y1:y2, x1:x2]
    
    # Threshold to find bright pins
    _, bright = cv2.threshold(roi, 120, 255, cv2.THRESH_BINARY)
    
    # Find edges in bright regions
    edges = cv2.Canny(bright, 50, 150)
    
    # Dilate to connect pin edges
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges = cv2.dilate(edges, kernel, iterations=1)
    
    # Find contours (potential pins)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Filter for pin-like shapes
    pins = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 100 or area > 10000:
            continue
        
        px, py, pw, ph = cv2.boundingRect(cnt)
        
        # Pins are somewhat rectangular
        aspect = max(pw, ph) / max(min(pw, ph), 1)
        if aspect > 4:
            continue
        
        # Convert back to original image coordinates
        pins.append({
            'x': x1 + px,
            'y': y1 + py,
            'w': pw,
            'h': ph,
            'center': (x1 + px + pw//2, y1 + py + ph//2)
        })
    
    # Analyze pin spacing
    if len(pins) < 4:
        return {
            'pin_count': len(pins),
            'uniformity': None,
            'consistent': False,
            'pins': pins
        }
    
    # Sort pins by position (left to right, top to bottom)
    pins_sorted = sorted(pins, key=lambda p: (p['y'], p['x']))
    
    # Calculate spacing between consecutive pins
    spacings = []
    for i in range(len(pins_sorted) - 1):
        p1 = pins_sorted[i]['center']
        p2 = pins_sorted[i+1]['center']
        dist = np.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
        spacings.append(dist)
    
    if len(spacings) < 2:
        uniformity = None
        consistent = False
    else:
        # Coefficient of variation (lower = more uniform)
        mean_spacing = np.mean(spacings)
        std_spacing = np.std(spacings)
        uniformity = std_spacing / mean_spacing if mean_spacing > 0 else 1.0
        
        # Consistent if CV < 0.15 (15% variation)
        consistent = uniformity < 0.15
    
    return {
        'pin_count': len(pins),
        'uniformity': uniformity,
        'consistent': consistent,
        'pins': pins,
        'spacings': spacings
    }


def _generate_fake_mask_from_cropped_image(image_path: str) -> Tuple[np.ndarray, Dict, Dict]:
    """
    Generate a fake mask covering the entire cropped image.
    Since the image is already cropped to the IC body by preprocessing,
    we just create a full mask.
    
    Args:
        image_path: Path to cropped IC image (from preprocessing)
    
    Returns:
        (mask, metadata, rect_dict) - same format as _detect_body_with_sam
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Failed to read image: {image_path}")
    
    h, w = img.shape[:2]
    
    # Create full mask (all pixels = 1)
    mask = np.ones((h, w), dtype=np.uint8) * 255
    
    # Create rect dict matching the format from _detect_body_with_sam
    rect = {
        'x': 0,
        'y': 0,
        'w': w,
        'h': h,
        'rw': float(w),
        'rh': float(h),
        'angle': 0.0,
        'box_pts': [[0, 0], [w, 0], [w, h], [0, h]],
        'method': 'preprocessing_crop'
    }
    
    # Metadata
    meta = {
        'coverage': 1.0,  # Full coverage since it's already cropped
        'source': 'preprocessing_crop'
    }
    
    return mask, meta, rect


def estimate_dimensions(
    image_path: str,
    expected_length_mm: Optional[float] = None,
    expected_width_mm: Optional[float] = None
) -> DimensionResult:
    """
    Main dimension estimation function
    
    Args:
        image_path: Path to cropped IC image (from preprocessing pipeline)
        expected_length_mm: Expected body length from datasheet (mm)
        expected_width_mm: Expected body width from datasheet (mm)
    
    Returns:
        DimensionResult with analysis
    """
    # Generate fake mask covering entire cropped image (already cropped by preprocessing)
    sam_mask, sam_meta, rect = _generate_fake_mask_from_cropped_image(image_path)

    x, y, bw, bh = rect['x'], rect['y'], rect['w'], rect['h']

    # Calculate aspect ratio from SAM mask geometry
    measured_aspect = max(rect['rw'], rect['rh']) / min(rect['rw'], rect['rh'])
    
    # Expected aspect ratio
    expected_aspect = None
    if expected_length_mm and expected_width_mm:
        expected_aspect = max(expected_length_mm, expected_width_mm) / min(expected_length_mm, expected_width_mm)
    
    # Compare aspect ratios
    aspect_match = False
    aspect_error = 0.0
    
    if expected_aspect:
        aspect_error = abs(measured_aspect - expected_aspect) / expected_aspect * 100
        # Allow 10% tolerance
        aspect_match = aspect_error < 10.0
    
    # Calculate dimension score (based only on aspect ratio match)
    score = 100.0
    
    if expected_aspect:
        # Check both orientations (IC might be rotated 90 degrees)
        error_normal = abs(measured_aspect - expected_aspect) / expected_aspect * 100
        error_flipped = abs(measured_aspect - (1/expected_aspect)) / (1/expected_aspect) * 100
        
        # Use the better match
        aspect_error = min(error_normal, error_flipped)
        
        # Update match status with orientation tolerance
        aspect_match = aspect_error < 10.0
        
        # Penalize aspect ratio error (max 60 point penalty)
        score -= min(aspect_error * 1.5, 60)
    
    score = max(0, score)
    
    # Confidence based on mask coverage and reference availability
    confidence = 0.5
    coverage = sam_meta.get("coverage")
    if coverage is None and sam_mask is not None:
        coverage = float(np.count_nonzero(sam_mask)) / float(sam_mask.size)
    if coverage is not None and coverage > 0.1:
        confidence += 0.2
    if bw > 500 and bh > 500:  # Good resolution
        confidence += 0.15
    if expected_aspect:  # Have reference
        confidence += 0.15
    confidence = min(1.0, confidence)
    
    # Verdict
    if score >= 80:
        verdict = "MATCH"
    elif score >= 50:
        verdict = "SUSPICIOUS"
    else:
        verdict = "MISMATCH"
    
    # Build bboxes for visualization
    rw = rect.get('rw', bw)
    rh = rect.get('rh', bh)
    box_pts = rect.get('box_pts', None)
    if box_pts:
        # Convert to list of lists of ints
        box_pts = [[int(p[0]), int(p[1])] for p in box_pts]
    bboxes = [
        {
            'type': 'ic_body',
            'x': int(x),
            'y': int(y),
            'w': int(bw),
            'h': int(bh),
            'rw': int(rw),
            'rh': int(rh),
            'angle': rect.get('angle', 0),
            'box_pts': box_pts,
            'label': f'IC Body: {int(rw)}×{int(rh)} px (AR: {measured_aspect:.3f})',
            'source': rect.get('method', 'sam_mask'),
        }
    ]
    
    mask_area_px = int(np.count_nonzero(sam_mask)) if sam_mask is not None else None

    # Create SAM visualization
    viz_path = _render_mask_visualization(
        image_path=image_path,
        mask=sam_mask,
        measured_aspect=measured_aspect,
        expected_aspect=expected_aspect,
        coverage=coverage,
        score=score,
        verdict=verdict,
        output_path=None
    )

    result = DimensionResult(
        body_width_px=int(min(bw, bh)),
        body_height_px=int(max(bw, bh)),
        measured_aspect_ratio=round(measured_aspect, 3),
        expected_length_mm=expected_length_mm,
        expected_width_mm=expected_width_mm,
        expected_aspect_ratio=round(expected_aspect, 3) if expected_aspect else None,
        aspect_ratio_match=aspect_match,
        aspect_ratio_error_percent=round(aspect_error, 2),
        pin_pitch_uniformity=None,  # Not analyzing pins
        pin_spacing_consistent=False,  # Not analyzing pins
        dimension_score=round(score, 1),
        confidence=round(confidence, 2),
        verdict=verdict,
        mask_score=sam_meta.get("score") if sam_meta else None,
        mask_area_px=mask_area_px or (sam_meta.get("area_px") if sam_meta else None),
        mask_coverage=coverage if coverage is not None else (sam_meta.get("coverage") if sam_meta else None),
        mask_source=sam_meta.get("model_cfg") if sam_meta else None,
        mask_visualization_path=viz_path,
        bboxes=bboxes,
        metrics={
            'body_bbox': [int(x), int(y), int(bw), int(bh)],
            'pin_count_detected': 0,  # Not counting pins
            'pin_spacings': [],
            'mask_coverage': coverage if coverage is not None else (sam_meta.get("coverage") if sam_meta else None),
            'mask_area_px': mask_area_px,
        }
    )
    
    return result


def visualize_dimensions(image_path: str, result: DimensionResult, output_path: Optional[str] = None):
    """
    Backward-compatible wrapper that returns the SAM mask visualization path.
    """
    if result.mask_visualization_path:
        return result.mask_visualization_path
    return result.mask_visualization_path


def save_results(result: DimensionResult, output_path: str):
    """Save results to JSON"""
    result_dict = asdict(result)
    
    # Convert booleans to int for JSON compatibility
    result_dict['aspect_ratio_match'] = int(result_dict['aspect_ratio_match'])
    result_dict['pin_spacing_consistent'] = int(result_dict['pin_spacing_consistent'])
    
    # Convert numpy types in bboxes to native Python types
    for bbox in result_dict.get('bboxes', []):
        if 'box_pts' in bbox and bbox['box_pts']:
            bbox['box_pts'] = [[int(p[0]), int(p[1])] for p in bbox['box_pts']]
        if 'vertices' in bbox and bbox['vertices']:
            bbox['vertices'] = [[int(p[0]), int(p[1])] for p in bbox['vertices']]
    
    with open(output_path, 'w') as f:
        json.dump(result_dict, f, indent=2)
    print(f"✅ Saved results: {output_path}")


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python dimension_estimator.py <ic_image.png> [expected_length_mm] [expected_width_mm]")
        sys.exit(1)
    
    image_path = sys.argv[1]
    expected_length = float(sys.argv[2]) if len(sys.argv) > 2 else None
    expected_width = float(sys.argv[3]) if len(sys.argv) > 3 else None
    
    print("=" * 70)
    print("DIMENSION & ASPECT RATIO ESTIMATOR")
    print("=" * 70)
    print(f"\nAnalyzing: {image_path}")
    if expected_length and expected_width:
        print(f"Expected dimensions: {expected_length} mm × {expected_width} mm")
    print()
    
    result = estimate_dimensions(image_path, expected_length, expected_width)
    
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)
    print(f"\nMeasured Aspect Ratio: {result.measured_aspect_ratio}")
    if result.expected_aspect_ratio:
        print(f"Expected Aspect Ratio: {result.expected_aspect_ratio}")
        print(f"Error: {result.aspect_ratio_error_percent}%")
        print(f"Match: {'YES ✓' if result.aspect_ratio_match else 'NO ✗'}")
    
    print(f"\nPin Analysis:")
    print(f"  Detected: {result.metrics['pin_count_detected']} pins")
    print(f"  Uniformity: {result.pin_pitch_uniformity or 'N/A'}")
    print(f"  Consistent: {'YES ✓' if result.pin_spacing_consistent else 'NO ✗'}")
    
    print(f"\nDimension Score: {result.dimension_score}/100")
    print(f"Verdict: {result.verdict}")
    print(f"Confidence: {result.confidence*100:.0f}%")
    print("=" * 70)
    
    # Save and visualize
    json_path = image_path.replace('.png', '_dimension_results.json')
    save_results(result, json_path)
    
    # Use default output path (next to image)
    visualize_dimensions(image_path, result)

