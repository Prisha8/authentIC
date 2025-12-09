#!/usr/bin/env python3
"""
Analyze histogram statistics for all filter outputs and generate JSON report.
This provides quantitative metrics that can be sent to Gemini along with the dashboard.
"""

import json
import cv2
import numpy as np
from pathlib import Path
from typing import Dict, List
from PIL import Image
import math

def calculate_entropy(histogram: np.ndarray) -> float:
    """Calculate entropy of histogram distribution"""
    # Normalize histogram to probabilities
    hist_norm = histogram.astype(float) / (histogram.sum() + 1e-10)
    # Remove zeros to avoid log(0)
    hist_norm = hist_norm[hist_norm > 0]
    # Calculate entropy
    entropy = -np.sum(hist_norm * np.log2(hist_norm + 1e-10))
    return float(entropy)

def analyze_image_statistics(image_path: Path) -> Dict:
    """Analyze an image and return comprehensive statistics"""
    try:
        img = cv2.imread(str(image_path))
        if img is None:
            # Try PIL if OpenCV fails
            pil_img = Image.open(image_path)
            img = np.array(pil_img.convert('RGB'))
            if len(img.shape) == 2:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        
        # Convert to grayscale for single-channel analysis
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        
        # Calculate histogram
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        hist = hist.flatten()
        
        # Basic statistics
        mean = float(np.mean(gray))
        std = float(np.std(gray))
        variance = float(np.var(gray))
        min_val = float(np.min(gray))
        max_val = float(np.max(gray))
        median = float(np.median(gray))
        
        # Histogram statistics
        hist_mean = float(np.sum(np.arange(256) * hist) / (hist.sum() + 1e-10))
        hist_std = float(np.sqrt(np.sum((np.arange(256) - hist_mean) ** 2 * hist) / (hist.sum() + 1e-10)))
        entropy = calculate_entropy(hist)
        
        # Contrast metrics
        contrast = float(max_val - min_val)
        dynamic_range = float(max_val - min_val) / 255.0 if max_val > min_val else 0.0
        
        # Peak detection (find dominant intensity values)
        peaks = []
        hist_smooth = cv2.GaussianBlur(hist.reshape(1, -1), (1, 5), 0).flatten()
        for i in range(1, 255):
            if hist_smooth[i] > hist_smooth[i-1] and hist_smooth[i] > hist_smooth[i+1]:
                if hist_smooth[i] > np.max(hist_smooth) * 0.1:  # At least 10% of max
                    peaks.append(int(i))
        
        # Skewness and kurtosis
        hist_norm = hist / (hist.sum() + 1e-10)
        values = np.arange(256)
        mean_val = np.sum(values * hist_norm)
        std_val = np.sqrt(np.sum((values - mean_val) ** 2 * hist_norm))
        
        if std_val > 0:
            skewness = float(np.sum(((values - mean_val) / std_val) ** 3 * hist_norm))
            kurtosis = float(np.sum(((values - mean_val) / std_val) ** 4 * hist_norm) - 3)
        else:
            skewness = 0.0
            kurtosis = 0.0
        
        # Uniformity (how evenly distributed the histogram is)
        uniformity = float(1.0 - (entropy / 8.0))  # Normalize by max entropy (log2(256) = 8)
        
        # Energy (sum of squared histogram values)
        energy = float(np.sum(hist ** 2))
        
        return {
            'mean': round(mean, 2),
            'std': round(std, 2),
            'variance': round(variance, 2),
            'min': round(min_val, 2),
            'max': round(max_val, 2),
            'median': round(median, 2),
            'histogram_mean': round(hist_mean, 2),
            'histogram_std': round(hist_std, 2),
            'entropy': round(entropy, 3),
            'contrast': round(contrast, 2),
            'dynamic_range': round(dynamic_range, 3),
            'skewness': round(skewness, 3),
            'kurtosis': round(kurtosis, 3),
            'uniformity': round(uniformity, 3),
            'energy': round(energy, 2),
            'peak_intensities': peaks[:5] if peaks else [],  # Top 5 peaks
            'num_peaks': len(peaks)
        }
    except Exception as e:
        return {
            'error': str(e),
            'mean': 0.0,
            'std': 0.0,
            'entropy': 0.0
        }

def generate_histogram_analysis_json(manifest_path: str, output_path: str = None) -> str:
    """
    Generate JSON report with histogram statistics for all filter outputs.
    
    Args:
        manifest_path: Path to histogram_manifest.json
        output_path: Optional output path (defaults to histogram_analysis.json in same dir)
    
    Returns:
        Path to created JSON file
    """
    manifest_path = Path(manifest_path)
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    
    output_dir = Path(manifest['output_dir'])
    if output_path is None:
        output_path = output_dir / "histogram_analysis.json"
    else:
        output_path = Path(output_path)
    
    # Analyze each filter step
    analysis_results = {
        'input_image': manifest['input_image'],
        'analysis_timestamp': str(Path(manifest_path).stat().st_mtime),
        'filters': {}
    }
    
    print(f"Analyzing {len(manifest['steps'])} filter outputs...")
    
    for step in manifest['steps']:
        step_name = step['step']
        output_image = Path(step['output_image'])
        
        print(f"  → Analyzing {step_name}...")
        
        if output_image.exists():
            stats = analyze_image_statistics(output_image)
            analysis_results['filters'][step_name] = {
                'description': step['description'],
                'output_image': str(output_image),
                'statistics': stats
            }
        else:
            print(f"    Warning: {output_image} not found")
            analysis_results['filters'][step_name] = {
                'description': step['description'],
                'error': 'Output image not found',
                'statistics': {}
            }
    
    # Add summary/comparison metrics
    if len(analysis_results['filters']) > 0:
        # Find filter with highest contrast (best for defect detection)
        max_contrast = 0
        max_contrast_filter = None
        for name, data in analysis_results['filters'].items():
            if 'statistics' in data and 'contrast' in data['statistics']:
                contrast = data['statistics']['contrast']
                if contrast > max_contrast:
                    max_contrast = contrast
                    max_contrast_filter = name
        
        # Find filter with highest entropy (most information)
        max_entropy = 0
        max_entropy_filter = None
        for name, data in analysis_results['filters'].items():
            if 'statistics' in data and 'entropy' in data['statistics']:
                entropy = data['statistics']['entropy']
                if entropy > max_entropy:
                    max_entropy = entropy
                    max_entropy_filter = name
        
        analysis_results['summary'] = {
            'total_filters': len(analysis_results['filters']),
            'highest_contrast_filter': max_contrast_filter,
            'highest_entropy_filter': max_entropy_filter,
            'recommended_for_defect_detection': [
                '05_clahe',  # CLAHE is typically best for surface defects
                '07_edge_map',  # Edge map for cracks
                '10_otsu_threshold'  # Threshold for contamination
            ]
        }
    
    # Save JSON
    with open(output_path, 'w') as f:
        json.dump(analysis_results, f, indent=2)
    
    print(f"\n✓ Analysis JSON saved to: {output_path}")
    print(f"  Analyzed {len(analysis_results['filters'])} filters")
    
    return str(output_path)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate histogram analysis JSON")
    parser.add_argument("manifest", help="Path to histogram_manifest.json")
    parser.add_argument("--output", "-o", help="Output path (default: histogram_analysis.json in manifest dir)")
    args = parser.parse_args()
    
    json_path = generate_histogram_analysis_json(args.manifest, args.output)
    print(f"\n✓ Analysis complete: {json_path}")

