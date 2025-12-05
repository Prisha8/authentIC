#!/usr/bin/env python3
"""
Datasheet Parser with Mechanical Diagram Extraction

Parses OEM datasheets and extracts:
1. Structured specifications (JSON)
2. Mechanical/outline dimension diagrams (images)
3. Pin configurations
4. Electrical characteristics

Outputs are optimized for Gemini VLM analysis.
"""

import sys
from pathlib import Path
import json
import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import pdfplumber
    from PIL import Image
    import fitz  # PyMuPDF for better image extraction
except ImportError:
    print("Missing dependencies. Install with:")
    print("  pip install pdfplumber PyMuPDF Pillow")
    sys.exit(1)


@dataclass
class PackageDimensions:
    """Physical package dimensions"""
    length_mm: Optional[float] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    pin_count: Optional[int] = None
    pin_pitch_mm: Optional[float] = None
    package_type: Optional[str] = None


@dataclass
class DatasheetInfo:
    """Complete datasheet information"""
    part_number: str
    manufacturer: Optional[str] = None
    package_dimensions: Optional[PackageDimensions] = None
    pin_count: Optional[int] = None
    description: Optional[str] = None
    features: List[str] = None
    
    # Pages where key info is found
    mechanical_pages: List[int] = None
    pin_config_pages: List[int] = None
    
    # Extracted images
    mechanical_diagrams: List[str] = None  # Paths to saved images
    
    # Raw data
    electrical_specs: Dict = None
    

class DatasheetParser:
    """Parse datasheets and extract specifications + diagrams"""
    
    def __init__(self, pdf_path: str, output_dir: str = None):
        self.pdf_path = Path(pdf_path)
        self.output_dir = Path(output_dir) if output_dir else self.pdf_path.parent
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Keywords to identify mechanical/outline pages
        self.mechanical_keywords = [
            'outline dimension', 'package outline', 'mechanical dimension',
            'mechanical data', 'package drawing', 'land pattern',
            'footprint', 'mechanical specification', 'package information'
        ]
        
        # Keywords for pin configuration
        self.pin_keywords = [
            'pin configuration', 'pin assignment', 'pin description',
            'pin functions', 'terminal assignment'
        ]
    
    def parse(self, part_number: str, package_type: str = None, pin_count: int = None, manufacturer: str = None) -> DatasheetInfo:
        """
        Main parsing function
        
        Args:
            part_number: IC part number for context
            package_type: Specific package variant (e.g., 'D14', 'SOIC-14', 'QFN-32')
                         If provided, only this package's mechanical page is extracted
            pin_count: Pin count to help identify the correct package variant
            manufacturer: Manufacturer name (from Gemini identification, preferred over extraction)
        
        Returns:
            DatasheetInfo with all extracted data for the specified package
        """
        print(f"\n{'='*70}")
        print(f"PARSING DATASHEET: {self.pdf_path.name}")
        print(f"Part Number: {part_number}")
        if package_type:
            print(f"Target Package: {package_type}" + (f" ({pin_count}-pin)" if pin_count else ""))
        print(f"{'='*70}\n")
        
        info = DatasheetInfo(
            part_number=part_number,
            manufacturer=manufacturer,  # Use Gemini's identification
            features=[],
            mechanical_pages=[],
            pin_config_pages=[],
            mechanical_diagrams=[],
            electrical_specs={}
        )
        
        # Store target package info
        self.target_package_type = package_type.upper() if package_type else None
        self.target_pin_count = pin_count
        
        # Step 1: Identify key pages
        print("📄 Step 1: Scanning pages...")
        self._identify_key_pages(info)
        
        # Step 2: Extract mechanical diagrams (filtered by package type)
        print("\n📐 Step 2: Extracting mechanical diagram(s)...")
        selected_page_num = self._extract_mechanical_diagrams(info)
        
        # Step 3: Parse package dimensions from the SELECTED page only
        print("\n📏 Step 3: Parsing package dimensions...")
        self._parse_package_dimensions(info, selected_page=selected_page_num)
        
        # Step 4: Extract physical/visual specs (NOT electrical)
        print("\n📋 Step 4: Extracting physical/visual specifications...")
        self._extract_physical_specs(info)
        
        print(f"\n{'='*70}")
        print("PARSING COMPLETE")
        print(f"{'='*70}")
        
        return info
    
    def _identify_key_pages(self, info: DatasheetInfo):
        """Scan PDF and identify pages with mechanical diagrams, pin configs, etc."""
        
        mechanical_section_pages = []  # Track pages that are mechanical section headers
        
        with pdfplumber.open(self.pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                text = page.extract_text()
                if not text:
                    continue
                
                text_lower = text.lower()
                
                # Check for mechanical/outline pages
                for keyword in self.mechanical_keywords:
                    if keyword in text_lower:
                        info.mechanical_pages.append(page_num)
                        print(f"  ✓ Found mechanical page: {page_num} ('{keyword}')")
                        
                        # If this is a section header (short page), mark it
                        if len(text.strip()) < 100:
                            mechanical_section_pages.append(page_num)
                        break
                
                # Check for pin configuration pages
                for keyword in self.pin_keywords:
                    if keyword in text_lower:
                        info.pin_config_pages.append(page_num)
                        print(f"  ✓ Found pin config page: {page_num} ('{keyword}')")
                        break
        
        # Add pages immediately after mechanical section headers (likely image-only diagrams)
        with pdfplumber.open(self.pdf_path) as pdf:
            for header_page in mechanical_section_pages:
                # Check next 3 pages after header
                for offset in range(1, 4):
                    next_page_num = header_page + offset
                    if next_page_num <= len(pdf.pages):
                        next_page = pdf.pages[next_page_num - 1]
                        next_text = next_page.extract_text() or ''
                        
                        # If page has no text or very little text, it's likely a diagram
                        if len(next_text.strip()) < 50:
                            if next_page_num not in info.mechanical_pages:
                                info.mechanical_pages.append(next_page_num)
                                print(f"  ✓ Found image-only mechanical page: {next_page_num} (after header page {header_page})")
                        else:
                            # Stop if we hit a page with substantial text
                            break
        
        # Deduplicate and sort
        info.mechanical_pages = sorted(list(set(info.mechanical_pages)))
        info.pin_config_pages = sorted(list(set(info.pin_config_pages)))
    
    def _extract_mechanical_diagrams(self, info: DatasheetInfo) -> Optional[int]:
        """Extract mechanical diagram pages as images for Gemini analysis
        
        If target_package_type is specified, only extract the matching package's page.
        Otherwise, extract all mechanical pages.
        
        Returns:
            Page number of the best selected diagram (for dimension parsing)
        """
        
        if not info.mechanical_pages:
            print("  ⚠️  No mechanical pages found")
            return
        
        # Use PyMuPDF for better image quality
        # Use context manager to ensure file is properly closed
        pages_to_extract = []
        
        with fitz.open(self.pdf_path) as doc:
            # Filter pages by package type if specified
            if self.target_package_type:
                print(f"  🎯 Filtering for package type: {self.target_package_type}")
                
                for page_num in info.mechanical_pages:
                    try:
                        page = doc[page_num - 1]
                        page_text = page.get_text().upper()
                        
                        # Check if this page matches the target package
                        # Look for package designator (e.g., "D14", "PW14", "NS14")
                        # or package type name (e.g., "SOIC", "QFN")
                        if self._is_matching_package(page_text, self.target_package_type, self.target_pin_count):
                            pages_to_extract.append(page_num)
                            print(f"  ✓ Match found on page {page_num}")
                    except Exception as e:
                        print(f"  ⚠️  Error checking page {page_num}: {e}")
                        continue
                
                if not pages_to_extract:
                    print(f"  ⚠️  No pages found for {self.target_package_type}, extracting ALL mechanical pages for scoring")
                    pages_to_extract = info.mechanical_pages
            else:
                pages_to_extract = info.mechanical_pages
            
            # Extract the selected pages
            for page_num in pages_to_extract:
                try:
                    page = doc[page_num - 1]  # PyMuPDF is 0-indexed
                    
                    # Render page to image at high resolution
                    zoom = 2.0  # 2x zoom for better quality
                    mat = fitz.Matrix(zoom, zoom)
                    pix = page.get_pixmap(matrix=mat)
                    
                    # Save as PNG
                    package_suffix = f"_{self.target_package_type}" if self.target_package_type else ""
                    output_filename = f"{self.pdf_path.stem}_mechanical{package_suffix}_page{page_num}.png"
                    output_path = self.output_dir / output_filename
                    pix.save(str(output_path))
                    
                    info.mechanical_diagrams.append(str(output_path))
                    print(f"  ✓ Saved: {output_filename} ({pix.width}x{pix.height}px)")
                    
                    # Clean up pixmap
                    pix = None
                    
                except Exception as e:
                    print(f"  ✗ Failed to extract page {page_num}: {e}")
                    import traceback
                    traceback.print_exc()
        
        # Return the first extracted page number (for dimension parsing)
        return pages_to_extract[0] if pages_to_extract else None
    
    def _is_matching_package(self, page_text: str, target_package: str, target_pin_count: int = None) -> bool:
        """Check if a page matches the target package type"""
        
        # Normalize package name
        target = target_package.upper().strip()
        
        # Common package type aliases
        package_aliases = {
            'DIP': ['DIP', 'PDIP', 'DUAL IN-LINE'],
            'SOIC': ['SOIC', 'SO', 'SMALL OUTLINE'],
            'QFP': ['QFP', 'LQFP', 'TQFP', 'QUAD FLAT'],
            'QFN': ['QFN', 'MLF', 'QUAD FLAT NO-LEAD'],
            'BGA': ['BGA', 'BALL GRID'],
            'TSSOP': ['TSSOP', 'THIN SHRINK'],
            'MSOP': ['MSOP', 'MICRO SMALL'],
            'SOT': ['SOT', 'SMALL OUTLINE TRANSISTOR']
        }
        
        # Direct match on package designator (e.g., "D14", "PW14")
        if target in page_text:
            return True
        
        # Check aliases
        for base_type, aliases in package_aliases.items():
            if base_type in target or any(alias in target for alias in aliases):
                if any(alias in page_text for alias in aliases):
                    # If pin count is provided, verify it matches
                    if target_pin_count:
                        # Look for pin count on the page
                        pin_patterns = [
                            f'{target_pin_count}-PIN',
                            f'{target_pin_count} PIN',
                            f'{target_pin_count}PIN'
                        ]
                        if any(pattern in page_text for pattern in pin_patterns):
                            return True
                    else:
                        return True
        
        return False
    
    def _parse_package_dimensions(self, info: DatasheetInfo, selected_page: int = None):
        """Parse package dimensions from text and tables
        
        Args:
            info: DatasheetInfo object
            selected_page: If provided, ONLY parse from this page (the best diagram page)
        """
        
        dimensions = PackageDimensions()
        
        # Set target package info if provided
        if self.target_package_type:
            dimensions.package_type = self.target_package_type
        if self.target_pin_count:
            dimensions.pin_count = self.target_pin_count
        
        with pdfplumber.open(self.pdf_path) as pdf:
            # If a specific page is selected, ONLY parse from that page
            if selected_page:
                pages_to_check = [selected_page]
                print(f"  → Parsing dimensions from selected page {selected_page} only")
            else:
                # Focus on mechanical pages first
                pages_to_check = info.mechanical_pages if info.mechanical_pages else range(1, min(len(pdf.pages) + 1, 20))
            
            for page_num in pages_to_check:
                page = pdf.pages[page_num - 1]
                text = page.extract_text()
                
                if not text:
                    continue
                
                # Extract package type
                if not dimensions.package_type:
                    package_match = re.search(r'\b(DIP|SOIC|QFP|QFN|BGA|TSSOP|MSOP|SOT|LQFP|PDIP|PLCC)\b', text, re.IGNORECASE)
                    if package_match:
                        dimensions.package_type = package_match.group(1).upper()
                
                # Extract pin count
                if not dimensions.pin_count:
                    pin_match = re.search(r'(\d+)[- ]pin', text, re.IGNORECASE)
                    if pin_match:
                        dimensions.pin_count = int(pin_match.group(1))
                
                # Extract dimensions from title (e.g., "LQFP64 – 10 x 10 mm")
                title_dim_pattern = r'(\d+)\s*x\s*(\d+)\s*mm'
                title_match = re.search(title_dim_pattern, text)
                if title_match:
                    dim1 = float(title_match.group(1))
                    dim2 = float(title_match.group(2))
                    dimensions.length_mm = max(dim1, dim2)
                    dimensions.width_mm = min(dim1, dim2)
                    print(f"    Found from title: {dimensions.length_mm} × {dimensions.width_mm} mm")
                
                # Extract height (max)
                height_pattern = r'([\d.]+)\s*mm\s*max(?:imum)?\s*height'
                height_match = re.search(height_pattern, text, re.IGNORECASE)
                if height_match and not dimensions.height_mm:
                    dimensions.height_mm = float(height_match.group(1))
                
                # Extract pin pitch
                pitch_pattern = r'(?:pin\s*)?pitch[:\s]*([\d.]+)\s*mm'
                pitch_match = re.search(pitch_pattern, text, re.IGNORECASE)
                if pitch_match and not dimensions.pin_pitch_mm:
                    dimensions.pin_pitch_mm = float(pitch_match.group(1))
                
                # Parse tables for more structured data
                tables = page.extract_tables()
                for table in tables:
                    self._parse_dimension_table(table, dimensions)
        
        info.package_dimensions = dimensions
        
        # Print what we found
        print(f"  Package Type: {dimensions.package_type or 'Not found'}")
        print(f"  Pin Count: {dimensions.pin_count or 'Not found'}")
        print(f"  Dimensions: {dimensions.length_mm or '?'} × {dimensions.width_mm or '?'} mm")
        print(f"  Height: {dimensions.height_mm or 'Not found'} mm")
        print(f"  Pin Pitch: {dimensions.pin_pitch_mm or 'Not found'} mm")
    
    def _parse_dimension_table(self, table: List[List], dimensions: PackageDimensions):
        """Parse dimension information from a table
        
        Looks for standard symbols:
        - D1/E1: Body length/width
        - A: Total height
        - e: Pin pitch
        """
        
        if not table:
            return
        
        for row in table:
            if not row or len(row) < 2:
                continue
            
            # First cell is usually the symbol
            symbol = str(row[0]).strip() if row[0] else ""
            
            # Look for D1 (body length)
            if symbol == 'D1' and not dimensions.length_mm:
                for cell in row[1:]:
                    if cell:
                        try:
                            val = float(str(cell).strip())
                            if 2.0 <= val <= 50.0:  # Reasonable range
                                dimensions.length_mm = val
                                print(f"    Found D1 (length): {val} mm")
                                break
                        except:
                            pass
            
            # Look for E1 (body width)
            elif symbol == 'E1' and not dimensions.width_mm:
                for cell in row[1:]:
                    if cell:
                        try:
                            val = float(str(cell).strip())
                            if 2.0 <= val <= 50.0:
                                dimensions.width_mm = val
                                print(f"    Found E1 (width): {val} mm")
                                break
                        except:
                            pass
            
            # Look for A (height)
            elif symbol == 'A' and not dimensions.height_mm:
                for cell in row[1:]:
                    if cell:
                        try:
                            val = float(str(cell).strip())
                            if 0.5 <= val <= 10.0:  # Reasonable height range
                                dimensions.height_mm = val
                                print(f"    Found A (height): {val} mm")
                                break
                        except:
                            pass
            
            # Look for e (pin pitch)
            elif symbol == 'e' and not dimensions.pin_pitch_mm:
                for cell in row[1:]:
                    if cell:
                        try:
                            val = float(str(cell).strip())
                            if 0.3 <= val <= 5.0:  # Typical pitch range
                                dimensions.pin_pitch_mm = val
                                print(f"    Found e (pin pitch): {val} mm")
                                break
                        except:
                            pass
    
    def _extract_physical_specs(self, info: DatasheetInfo):
        """Extract PHYSICAL/VISUAL specifications (NOT electrical) for Gemini analysis"""
        
        physical_features = []
        
        with pdfplumber.open(self.pdf_path) as pdf:
            # Check first 5 pages for physical specs
            for page_num in range(min(5, len(pdf.pages))):
                page = pdf.pages[page_num]
                text = page.extract_text()
                
                if not text:
                    continue
                
                # Extract manufacturer ONLY if not already set (from Gemini identification)
                # This prevents incorrect extraction (e.g., "Maxim" mentioned in cross-references)
                # Gemini's identification is more reliable than text extraction
                if not info.manufacturer:
                    # Only extract if Gemini didn't provide it
                    manufacturers = ['Texas Instruments', 'Analog Devices', 'Microchip', 
                                   'STMicroelectronics', 'NXP', 'Infineon', 'Renesas',
                                   'ON Semiconductor', 'Maxim Integrated', 'Maxim', 'Intel', 'AMD',
                                   'Atmel', 'Fairchild', 'National Semiconductor']
                    
                    # Look for manufacturer in title/header area (first 500 chars) for better accuracy
                    header_text = text[:500].lower()
                    for mfg in manufacturers:
                        mfg_lower = mfg.lower()
                        # Check if manufacturer appears in header (more reliable)
                        if mfg_lower in header_text:
                            # Additional check: make sure it's not just a mention in a list
                            # Look for patterns like "Manufacturer: X" or "© X" or "X Corporation"
                            patterns = [
                                rf'\b{mfg_lower}\b',  # Word boundary match
                                rf'©\s*{mfg_lower}',  # Copyright
                                rf'{mfg_lower}\s+(?:corporation|inc|ltd|semiconductor)',  # Company suffix
                            ]
                            for pattern in patterns:
                                if re.search(pattern, header_text, re.IGNORECASE):
                                    info.manufacturer = mfg
                                    print(f"  ✓ Extracted manufacturer from PDF: {mfg}")
                                    break
                            if info.manufacturer:
                                break
                elif info.manufacturer:
                    # Manufacturer already set from Gemini - use it and don't overwrite
                    print(f"  ✓ Using manufacturer from Gemini identification: {info.manufacturer}")
                
                # Extract description (usually in first page)
                if not info.description and page_num == 0:
                    desc_match = re.search(r'(?:Description|General Description)[:\n]+(.*?)(?:\n\n|Features|Applications)', 
                                         text, re.IGNORECASE | re.DOTALL)
                    if desc_match:
                        info.description = desc_match.group(1).strip()[:200]
        
        # Extract PHYSICAL features from mechanical pages
        if info.mechanical_pages:
            with pdfplumber.open(self.pdf_path) as pdf:
                for page_num in info.mechanical_pages[:3]:  # Check first 3 mechanical pages
                    page = pdf.pages[page_num - 1]
                    text = page.extract_text()
                    
                    if not text:
                        continue
                    
                    # Look for physical/visual characteristics
                    physical_keywords = [
                        'pin 1 identifier', 'pin 1 marking', 'orientation mark',
                        'notch', 'dot marking', 'index mark', 'corner marking',
                        'package marking', 'top marking', 'logo placement',
                        'molding compound', 'lead finish', 'surface finish',
                        'plating', 'exposed pad', 'thermal pad',
                        'mold flash', 'gate burr', 'lead coplanarity'
                    ]
                    
                    lines = text.split('\n')
                    for line in lines:
                        line_lower = line.lower()
                        # Check if line contains physical keywords
                        for keyword in physical_keywords:
                            if keyword in line_lower:
                                physical_features.append(line.strip())
                                break
        
        info.features = physical_features
        
        print(f"  Manufacturer: {info.manufacturer or 'Not found'}")
        print(f"  Description: {info.description[:80] if info.description else 'Not found'}...")
        print(f"  Physical Features: {len(physical_features)} found")
        for feat in physical_features[:5]:  # Show first 5
            print(f"    - {feat[:80]}")
    
    def save_summary(self, info: DatasheetInfo, output_path: str = None):
        """Save parsed information as JSON for Gemini"""
        
        if not output_path:
            output_path = self.output_dir / f"{self.pdf_path.stem}_parsed.json"
        
        # Convert to dict
        data = asdict(info)
        
        # Add metadata
        data['source_pdf'] = str(self.pdf_path)
        data['parsing_metadata'] = {
            'total_mechanical_pages': len(info.mechanical_pages),
            'total_diagrams_extracted': len(info.mechanical_diagrams),
            'pin_config_pages': len(info.pin_config_pages)
        }
        
        with open(output_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"\n✅ Saved summary: {output_path}")
        return output_path


def main():
    """CLI interface"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Parse IC datasheet and extract mechanical diagrams",
        epilog="Example: python datasheet_parser.py datasheet.pdf SN74HC04 --package SOIC --pins 14"
    )
    parser.add_argument("pdf_path", help="Path to datasheet PDF")
    parser.add_argument("part_number", help="IC part number")
    parser.add_argument("--package", "-p", help="Specific package type (e.g., SOIC, D14, QFN-32)", default=None)
    parser.add_argument("--pins", "-n", type=int, help="Pin count", default=None)
    parser.add_argument("--output-dir", help="Output directory for images/JSON", default=None)
    
    args = parser.parse_args()
    
    # Parse datasheet
    ds_parser = DatasheetParser(args.pdf_path, args.output_dir)
    info = ds_parser.parse(args.part_number, args.package, args.pins)
    
    # Save summary
    ds_parser.save_summary(info)
    
    # Print summary
    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    print(f"Part Number: {info.part_number}")
    print(f"Manufacturer: {info.manufacturer or 'Unknown'}")
    print(f"Package: {info.package_dimensions.package_type or 'Unknown'} ({info.package_dimensions.pin_count or '?'} pins)")
    print(f"Dimensions: {info.package_dimensions.length_mm or '?'} × {info.package_dimensions.width_mm or '?'} mm")
    print(f"\nMechanical Diagrams: {len(info.mechanical_diagrams)} extracted")
    for diagram in info.mechanical_diagrams:
        print(f"  - {Path(diagram).name}")
    
    if info.features:
        print(f"\nPhysical/Visual Features Extracted: {len(info.features)}")
        for feat in info.features[:5]:
            print(f"  • {feat[:70]}")
    
    print(f"{'='*70}")


if __name__ == '__main__':
    main()

