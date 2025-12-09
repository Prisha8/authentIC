#!/usr/bin/env python3
"""
Create a comprehensive dashboard image showing all histogram filter outputs in a grid.
This allows sending all filter information to Gemini as a single image.
"""

import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

def create_histogram_dashboard(manifest_path: str, output_path: str = None) -> str:
    """
    Create a single dashboard image showing all histogram filter outputs.
    
    Args:
        manifest_path: Path to histogram_manifest.json
        output_path: Optional output path (defaults to dashboard.png in same dir)
    
    Returns:
        Path to created dashboard image
    """
    manifest_path = Path(manifest_path)
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    
    output_dir = Path(manifest['output_dir'])
    if output_path is None:
        output_path = output_dir / "histogram_dashboard.png"
    else:
        output_path = Path(output_path)
    
    # Load all processed images
    steps = manifest['steps']
    images = []
    step_names = []
    
    for step in steps:
        img_path = Path(step['output_image'])
        if img_path.exists():
            try:
                img = Image.open(img_path)
                # Resize to consistent size for grid
                img = img.resize((256, 256), Image.Resampling.LANCZOS)
                images.append(img)
                step_names.append(step['step'].replace('_', ' ').title())
            except Exception as e:
                print(f"Warning: Failed to load {img_path}: {e}")
    
    if not images:
        raise ValueError("No images found to create dashboard")
    
    # Create grid layout: 4 columns, 3 rows (for 11 images, last cell can be empty or show original)
    cols = 4
    rows = 3
    cell_width = 256
    cell_height = 256
    padding = 10
    label_height = 30
    
    # Calculate total dimensions
    total_width = cols * (cell_width + padding) + padding
    total_height = rows * (cell_height + label_height + padding) + padding
    
    # Create dashboard canvas
    dashboard = Image.new('RGB', (total_width, total_height), color='white')
    draw = ImageDraw.Draw(dashboard)
    
    # Try to load a font
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
        small_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
    except:
        try:
            font = ImageFont.truetype("Arial.ttf", 16)
            small_font = ImageFont.truetype("Arial.ttf", 12)
        except:
            font = ImageFont.load_default()
            small_font = font
    
    # Place images in grid
    for idx, (img, step_name) in enumerate(zip(images, step_names)):
        row = idx // cols
        col = idx % cols
        
        if row >= rows:
            break  # Skip if we exceed rows
        
        x = padding + col * (cell_width + padding)
        y = padding + row * (cell_height + label_height + padding)
        
        # Paste image
        dashboard.paste(img, (x, y))
        
        # Draw border
        draw.rectangle([x-1, y-1, x+cell_width, y+cell_height], outline='black', width=2)
        
        # Draw label background
        label_y = y + cell_height
        draw.rectangle([x, label_y, x+cell_width, label_y+label_height], fill='lightgray')
        
        # Draw step name (truncate if too long)
        label_text = step_name
        if len(label_text) > 20:
            label_text = label_text[:17] + "..."
        
        # Center text
        bbox = draw.textbbox((0, 0), label_text, font=small_font)
        text_width = bbox[2] - bbox[0]
        text_x = x + (cell_width - text_width) // 2
        text_y = label_y + (label_height - (bbox[3] - bbox[1])) // 2
        
        draw.text((text_x, text_y), label_text, fill='black', font=small_font)
    
    # Add title at top
    title = "Histogram Filter Analysis Dashboard"
    title_bbox = draw.textbbox((0, 0), title, font=font)
    title_width = title_bbox[2] - title_bbox[0]
    title_x = (total_width - title_width) // 2
    draw.text((title_x, 10), title, fill='black', font=font)
    
    # Add legend/description at bottom if space
    if len(images) < rows * cols:
        # Add description in remaining cells
        desc_text = "All filter outputs shown above. Use CLAHE for surface texture, Edge Map for cracks, Threshold for contamination."
        desc_y = padding + rows * (cell_height + label_height + padding) + 20
        
        # Wrap text
        words = desc_text.split()
        lines = []
        current_line = []
        current_width = 0
        
        for word in words:
            word_bbox = draw.textbbox((0, 0), word + " ", font=small_font)
            word_width = word_bbox[2] - word_bbox[0]
            if current_width + word_width > total_width - 2*padding:
                if current_line:
                    lines.append(" ".join(current_line))
                current_line = [word]
                current_width = word_width
            else:
                current_line.append(word)
                current_width += word_width
        
        if current_line:
            lines.append(" ".join(current_line))
        
        for i, line in enumerate(lines[:3]):  # Max 3 lines
            line_bbox = draw.textbbox((0, 0), line, font=small_font)
            line_width = line_bbox[2] - line_bbox[0]
            line_x = (total_width - line_width) // 2
            draw.text((line_x, desc_y + i * 20), line, fill='darkgray', font=small_font)
    
    # Save dashboard
    dashboard.save(output_path)
    print(f"Dashboard saved to: {output_path}")
    print(f"Dimensions: {total_width}x{total_height}")
    print(f"Contains {len(images)} filter outputs")
    
    return str(output_path)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Create histogram filter dashboard")
    parser.add_argument("manifest", help="Path to histogram_manifest.json")
    parser.add_argument("--output", "-o", help="Output path (default: dashboard.png in manifest dir)")
    args = parser.parse_args()
    
    dashboard_path = create_histogram_dashboard(args.manifest, args.output)
    print(f"\n✓ Dashboard created: {dashboard_path}")

