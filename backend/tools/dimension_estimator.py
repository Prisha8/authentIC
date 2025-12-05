#!/usr/bin/env python3
"""
Dimension & Aspect Ratio Estimator

Analyzes IC physical dimensions and proportions to detect counterfeits.

Key Metrics:
1. Aspect Ratio (length/width) - should match datasheet
2. Pin Pitch Uniformity - pins should be evenly spaced
3. Package Proportions - overall shape validation

Method:
- Detect IC body (main rectangular region)
- Measure dimensions in pixels
- Calculate aspect ratio
- Compare with expected specs
- Detect pin regions and measure spacing
"""

import cv2
import numpy as np
from scipy import stats
from dataclasses import dataclass, asdict
from typing import Dict, List, Tuple, Optional
import json
from pathlib import Path

# Set matplotlib to use non-GUI backend (required for Flask/threading)
import matplotlib
matplotlib.use('Agg')  # Non-GUI backend - works in threads

import matplotlib.pyplot as plt
import matplotlib.patches as patches


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
    

def detect_ic_body(image_path: str) -> Tuple[np.ndarray, Dict]:
    """
    Simple IC body detection using minAreaRect (older, simpler approach).
    Returns:
        image: Original image
        rect: dict with x, y, w, h (axis-aligned) and box_pts (rotated box)
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    
    # Simple threshold to isolate dark IC body
    _, dark_mask = cv2.threshold(gray, 90, 255, cv2.THRESH_BINARY_INV)
    
    # Clean up noise
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    
    contours, _ = cv2.findContours(dark_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    best_rect = None
    best_score = 0
    
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < (h * w * 0.10) or area > (h * w * 0.70):
            continue
        
        # Get bounding rectangle
        x, y, bw, bh = cv2.boundingRect(cnt)
        
        # Check if contour fills the bounding box (rectangular-ness)
        rect_area = bw * bh
        fill_ratio = area / rect_area
        
        # IC body should be very rectangular (fill > 0.85)
        if fill_ratio < 0.85:
            continue
        
        # Check aspect ratio is reasonable (ICs are typically 1:1 to 2.5:1)
        aspect = max(bw, bh) / min(bw, bh)
        if aspect > 3.0 or aspect < 1.0:
            continue
        
        # Score based on size and rectangularity
        score = area * fill_ratio
        
        if score > best_score:
            best_score = score
            best_rect = {
                'x': x, 'y': y, 'w': bw, 'h': bh,
                'rw': max(bw, bh),  # Longer side
                'rh': min(bw, bh),  # Shorter side
                'angle': 0,
                'box_pts': [
                    [x, y],
                    [x + bw, y],
                    [x + bw, y + bh],
                    [x, y + bh]
                ],
                'method': 'simple'
            }
    
    if best_rect is None:
        # Fallback: use center 50% of image
        margin_h = int(h * 0.25)
        margin_w = int(w * 0.25)
        best_rect = {
            'x': margin_w,
            'y': margin_h,
            'w': w - 2*margin_w,
            'h': h - 2*margin_h,
            'rw': max(w - 2*margin_w, h - 2*margin_h),
            'rh': min(w - 2*margin_w, h - 2*margin_h),
            'angle': 0,
            'box_pts': [
                [margin_w, margin_h],
                [w - margin_w, margin_h],
                [w - margin_w, h - margin_h],
                [margin_w, h - margin_h],
            ],
            'method': 'fallback'
        }
        print("⚠️  Warning: Could not detect IC body, using fallback bbox")
    else:
        print(f"✓ IC body detected - sides: {best_rect['rw']:.1f} × {best_rect['rh']:.1f} px")
    
    return img, best_rect


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


def estimate_dimensions(
    image_path: str,
    expected_length_mm: Optional[float] = None,
    expected_width_mm: Optional[float] = None
) -> DimensionResult:
    """
    Main dimension estimation function
    
    Args:
        image_path: Path to IC image
        expected_length_mm: Expected body length from datasheet (mm)
        expected_width_mm: Expected body width from datasheet (mm)
    
    Returns:
        DimensionResult with analysis
    """
    # Detect IC body
    img, rect = detect_ic_body(image_path)
    x, y, bw, bh = rect['x'], rect['y'], rect['w'], rect['h']
    
    # Calculate aspect ratio
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
    
    # Confidence based on detection quality
    confidence = 0.6
    if bw > 500 and bh > 500:  # Good resolution
        confidence += 0.2
    if expected_aspect:  # Have reference
        confidence += 0.2
    
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
            'label': f'IC Body: {int(rw)}×{int(rh)} px (AR: {measured_aspect:.3f})'
        }
    ]
    
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
        bboxes=bboxes,
        metrics={
            'body_bbox': [int(x), int(y), int(bw), int(bh)],
            'pin_count_detected': 0,  # Not counting pins
            'pin_spacings': []
        }
    )
    
    return result


def visualize_dimensions(image_path: str, result: DimensionResult):
    """
    Create a clean visualization showing only the image with detected IC body bbox.
    All detailed metrics will be shown in the PDF table instead.
    """
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    fig, ax = plt.subplots(figsize=(12, 9))
    ax.imshow(img_rgb)
    
    # Draw IC body bbox (rotated if available)
    body_bbox = [b for b in result.bboxes if b['type'] == 'ic_body'][0]
    rw = body_bbox.get('rw', body_bbox.get('w', 0))
    rh = body_bbox.get('rh', body_bbox.get('h', 0))
    
    if body_bbox.get('box_pts'):
        pts = np.array(body_bbox['box_pts'])
        poly = patches.Polygon(pts, closed=True, linewidth=4, edgecolor='#FF4444', facecolor='none')
        ax.add_patch(poly)
        # Position label at center horizontally, below the box vertically
        bx = pts[:,0].mean()
        by = pts[:,1].max() + 30  # Below the box
    else:
        rect = patches.Rectangle(
            (body_bbox['x'], body_bbox['y']),
            body_bbox['w'], body_bbox['h'],
            linewidth=4, edgecolor='#FF4444', facecolor='none'
        )
        ax.add_patch(rect)
        bx = body_bbox['x'] + body_bbox['w']/2
        by = body_bbox['y'] + body_bbox['h'] + 30
    
    # Add label (below the box to avoid overlap with title)
    label_text = f"IC Body Detected\n{int(rw)}×{int(rh)} px\nAR: {result.measured_aspect_ratio:.3f}"
    ax.text(
        bx, 
        by + 20,
        label_text,
        color='#FF4444', 
        fontsize=12, 
        fontweight='bold',
        ha='center',
        va='top',
        bbox=dict(boxstyle='round,pad=0.5', facecolor='white', edgecolor='#FF4444', linewidth=2, alpha=0.9)
    )
    
    ax.set_title('Dimension Analysis - Detected IC Body', fontsize=16, fontweight='bold', pad=20)
    ax.axis('off')
    
    plt.tight_layout()
    
    # Always save to PNG alongside the original, avoid overwriting non-PNG inputs
    img_path = Path(image_path)
    output_path = str(img_path.with_name(f"{img_path.stem}_dimension_analysis.png"))
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()  # Close to avoid display issues
    print(f"✅ Saved visualization: {output_path}")


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
    
    visualize_dimensions(image_path, result)

