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


def detect_ic_body(image_path: str) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    """
    Detect ONLY the IC body (dark rectangular region)
    Ignore pins - we only care about body dimensions
    
    Returns:
        image: Original image
        bbox: (x, y, w, h) of IC body
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    
    # Strategy: Find the DARK rectangular region (IC body is dark/black)
    # Use aggressive thresholding to isolate only the dark body
    
    # 1. Threshold to find DARK regions only (IC body is typically < 80 brightness)
    _, dark_mask = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)
    
    # 2. Clean up noise
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    
    # 3. Find contours
    contours, _ = cv2.findContours(dark_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # 4. Find the largest RECTANGULAR dark region
    best_rect = None
    best_score = 0
    
    for cnt in contours:
        area = cv2.contourArea(cnt)
        
        # Must be substantial (at least 10% of image, but not more than 70%)
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
            best_rect = (x, y, bw, bh)
    
    if best_rect is None:
        # Fallback: use center 50% of image
        margin_h = int(h * 0.25)
        margin_w = int(w * 0.25)
        best_rect = (margin_w, margin_h, w - 2*margin_w, h - 2*margin_h)
        print("⚠️  Warning: Could not detect IC body, using fallback bbox")
    
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
    img, (x, y, bw, bh) = detect_ic_body(image_path)
    
    # Calculate aspect ratio
    measured_aspect = max(bw, bh) / min(bw, bh)
    
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
    bboxes = [
        {
            'type': 'ic_body',
            'x': int(x),
            'y': int(y),
            'w': int(bw),
            'h': int(bh),
            'label': f'IC Body: {bw}×{bh}px (AR: {measured_aspect:.3f})'
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
    Visualize dimension analysis with bboxes and annotations
    """
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    fig = plt.figure(figsize=(20, 12))
    
    # Original with annotations
    ax1 = plt.subplot(2, 3, 1)
    ax1.imshow(img_rgb)
    ax1.set_title('Original Image', fontsize=14, fontweight='bold')
    ax1.axis('off')
    
    # Annotated with bboxes
    ax2 = plt.subplot(2, 3, 2)
    ax2.imshow(img_rgb)
    
    # Draw IC body
    body_bbox = [b for b in result.bboxes if b['type'] == 'ic_body'][0]
    rect = patches.Rectangle(
        (body_bbox['x'], body_bbox['y']),
        body_bbox['w'], body_bbox['h'],
        linewidth=3, edgecolor='red', facecolor='none'
    )
    ax2.add_patch(rect)
    ax2.text(
        body_bbox['x'], body_bbox['y'] - 10,
        body_bbox['label'],
        color='red', fontsize=10, fontweight='bold',
        bbox=dict(boxstyle='round', facecolor='white', alpha=0.8)
    )
    
    # Draw pins
    pin_bboxes = [b for b in result.bboxes if b['type'] == 'pin']
    for pin_bbox in pin_bboxes:
        rect = patches.Rectangle(
            (pin_bbox['x'], pin_bbox['y']),
            pin_bbox['w'], pin_bbox['h'],
            linewidth=2, edgecolor='green', facecolor='none'
        )
        ax2.add_patch(rect)
    
    ax2.set_title(f'Detected Regions ({len(pin_bboxes)} pins)', fontsize=14, fontweight='bold')
    ax2.axis('off')
    
    # Aspect ratio comparison
    ax3 = plt.subplot(2, 3, 3)
    ax3.axis('off')
    
    if result.expected_aspect_ratio:
        categories = ['Measured', 'Expected']
        values = [result.measured_aspect_ratio, result.expected_aspect_ratio]
        colors = ['blue', 'green']
        
        bars = ax3.barh(categories, values, color=colors, alpha=0.7, edgecolor='black', linewidth=2)
        ax3.set_xlabel('Aspect Ratio', fontsize=12)
        ax3.set_title('Aspect Ratio Comparison', fontsize=14, fontweight='bold')
        ax3.grid(True, alpha=0.3, axis='x')
        
        for bar, val in zip(bars, values):
            ax3.text(val + 0.05, bar.get_y() + bar.get_height()/2,
                    f'{val:.3f}', va='center', fontweight='bold')
    else:
        ax3.text(0.5, 0.5, f'Measured Aspect Ratio:\n{result.measured_aspect_ratio:.3f}\n\n(No expected value provided)',
                ha='center', va='center', fontsize=12, fontweight='bold')
    
    # Metrics summary
    ax4 = plt.subplot(2, 3, 4)
    ax4.axis('off')
    
    summary = f"""
DIMENSION ANALYSIS
{'='*35}

Body Dimensions:
  Width:  {result.body_width_px} px
  Height: {result.body_height_px} px
  Aspect: {result.measured_aspect_ratio:.3f}

Expected (from datasheet):
  Length: {result.expected_length_mm or 'N/A'} mm
  Width:  {result.expected_width_mm or 'N/A'} mm
  Aspect: {result.expected_aspect_ratio or 'N/A'}

Comparison:
  Match:  {'YES ✓' if result.aspect_ratio_match else 'NO ✗'}
  Error:  {result.aspect_ratio_error_percent:.2f}%

Pin Analysis:
  Detected: {result.metrics['pin_count_detected']} pins
  Uniformity: {result.pin_pitch_uniformity or 'N/A'}
  Consistent: {'YES ✓' if result.pin_spacing_consistent else 'NO ✗'}
    """
    
    color = 'green' if result.verdict == "MATCH" else 'orange' if result.verdict == "SUSPICIOUS" else 'red'
    ax4.text(0.05, 0.5, summary, fontsize=10, family='monospace',
             verticalalignment='center', color=color)
    
    # Score gauge
    ax5 = plt.subplot(2, 3, 5)
    ax5.axis('off')
    
    score_color = 'green' if result.dimension_score >= 80 else 'orange' if result.dimension_score >= 50 else 'red'
    
    ax5.text(0.5, 0.6, f"{result.dimension_score:.1f}/100",
             ha='center', va='center', fontsize=48, fontweight='bold', color=score_color)
    ax5.text(0.5, 0.4, "Dimension Score",
             ha='center', va='center', fontsize=14, fontweight='bold')
    ax5.text(0.5, 0.3, f"Confidence: {result.confidence*100:.0f}%",
             ha='center', va='center', fontsize=12)
    
    # Verdict
    ax6 = plt.subplot(2, 3, 6)
    ax6.axis('off')
    
    verdict_color = 'green' if result.verdict == "MATCH" else 'orange' if result.verdict == "SUSPICIOUS" else 'red'
    
    ax6.text(0.5, 0.5, f"{result.verdict}\n\n{result.dimension_score:.1f}/100\n\nConfidence: {result.confidence*100:.0f}%",
             ha='center', va='center', fontsize=18, fontweight='bold', color=verdict_color,
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5, pad=1))
    
    plt.tight_layout()
    
    output_path = image_path.replace('.png', '_dimension_analysis.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"\n✅ Saved visualization: {output_path}")
    
    plt.show()


def save_results(result: DimensionResult, output_path: str):
    """Save results to JSON"""
    result_dict = asdict(result)
    
    # Convert booleans to int for JSON compatibility
    result_dict['aspect_ratio_match'] = int(result_dict['aspect_ratio_match'])
    result_dict['pin_spacing_consistent'] = int(result_dict['pin_spacing_consistent'])
    
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

