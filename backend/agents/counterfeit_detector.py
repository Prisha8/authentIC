#!/usr/bin/env python3
"""
Counterfeit IC Detection Orchestrator

Main agent that coordinates the entire counterfeit detection pipeline:
1. IC Identification (Gemini VLM)
2. Datasheet Scraping
3. Datasheet Parsing (extract mechanical diagrams)
4. CV Tool Analysis (dimension estimation, surface analysis)
5. Gemini Visual Comparison (IC vs datasheet diagrams)
6. Report Generation (PDF with bboxes, scores, reasoning)

Usage:
    python counterfeit_detector.py <ic_image_path>
"""

import sys
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import time
from datetime import datetime

# Add parent directories to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import google.generativeai as genai
    from PIL import Image, ImageDraw, ImageFont
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, BaseDocTemplate, Paragraph, Spacer, Image as RLImage, PageBreak, Table, TableStyle, PageTemplate, Frame
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.pdfgen import canvas
except ImportError:
    print("Missing dependencies. Install with:")
    print("  pip install google-generativeai pillow reportlab")
    sys.exit(1)

# Import our tools - add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from utils import get_api_key
from tools.datasheet_scraper import DatasheetScraper
from tools.datasheet_parser import DatasheetParser
from tools.dimension_estimator import estimate_dimensions, DimensionResult
from agents.gemini_ic_identifier import identify_ic, setup_gemini


@dataclass
class DetectionResult:
    """Complete detection result"""
    ic_image_path: str  # Primary image path (for backward compatibility)
    ic_image_paths: List[str] = None  # All IC image paths (multiple views)
    part_number: str = "UNKNOWN"
    manufacturer: str = "UNKNOWN"
    package_type: str = "UNKNOWN"
    pin_count: int = 0
    
    # Datasheet info
    datasheet_path: Optional[str] = None
    mechanical_diagram_path: Optional[str] = None
    parsed_specs: Optional[Dict] = None
    
    # Additional context
    additional_info: Optional[str] = None  # User-provided additional information
    
    # Tool results
    dimension_analysis: Optional[Dict] = None
    dimension_visualization: Optional[str] = None
    surface_analysis: Optional[Dict] = None
    
    # Gemini analysis
    visual_comparison: Optional[Dict] = None
    anomalies: List[Dict] = None
    
    # Final verdict
    authenticity_score: float = 0.0
    verdict: str = "UNKNOWN"
    reasoning: str = ""
    
    # Metadata
    timestamp: str = ""
    processing_time_seconds: float = 0.0
    report_path: Optional[str] = None  # Path to generated PDF report
    
    def __post_init__(self):
        """Initialize ic_image_paths if not provided"""
        if self.ic_image_paths is None:
            self.ic_image_paths = [self.ic_image_path] if self.ic_image_path else []


class CounterfeitDetector:
    """Main orchestrator for counterfeit IC detection"""
    
    def __init__(self, output_dir: str = "./detection_results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize Gemini
        api_key = get_api_key("GEMINI_API_KEY")
        self.identifier_model = setup_gemini(api_key)  # For IC identification
        genai.configure(api_key=api_key)
        self.analysis_model = genai.GenerativeModel('gemini-2.5-flash')  # For visual analysis
        
        print(f"✅ Counterfeit Detector initialized")
        print(f"   Output directory: {self.output_dir}")
    
    def detect(self, ic_image_path: str) -> DetectionResult:
        """
        Main detection pipeline
        
        Args:
            ic_image_path: Path to IC image to analyze
        
        Returns:
            DetectionResult with complete analysis
        """
        start_time = time.time()
        ic_image_path = Path(ic_image_path)
        
        print(f"\n{'='*80}")
        print(f"COUNTERFEIT IC DETECTION PIPELINE")
        print(f"{'='*80}")
        print(f"Input Image: {ic_image_path.name}")
        print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*80}\n")
        
        result = DetectionResult(
            ic_image_path=str(ic_image_path),
            timestamp=datetime.now().isoformat(),
            anomalies=[]
        )
        
        # STEP 1: IC Identification
        print("🔍 STEP 1: IC Identification (Gemini VLM)")
        print("-" * 80)
        ic_info = self._identify_ic(ic_image_path)
        
        result.part_number = ic_info.get('part_number', 'UNKNOWN')
        result.manufacturer = ic_info.get('manufacturer', 'UNKNOWN')
        result.package_type = ic_info.get('package_type', 'UNKNOWN')
        result.pin_count = ic_info.get('pin_count', 0)
        
        print(f"✅ Identified: {result.part_number}")
        print(f"   Manufacturer: {result.manufacturer}")
        print(f"   Package: {result.package_type} ({result.pin_count}-pin)")
        
        # STEP 2: Datasheet Scraping
        print(f"\n📥 STEP 2: Datasheet Retrieval")
        print("-" * 80)
        datasheet_path = self._scrape_datasheet(result.part_number)
        result.datasheet_path = datasheet_path
        
        if datasheet_path:
            print(f"✅ Datasheet downloaded: {Path(datasheet_path).name}")
        else:
            print("⚠️  Datasheet not found - limited analysis possible")
        
        # STEP 3: Datasheet Parsing
        mechanical_diagram = None
        parsed_specs = None
        if datasheet_path:
            print(f"\n📐 STEP 3: Datasheet Parsing")
            print("-" * 80)
            mechanical_diagram, parsed_specs = self._parse_datasheet(
                datasheet_path, 
                result.part_number,
                result.package_type,
                result.pin_count,
                result.manufacturer  # Pass Gemini's manufacturer identification
            )
            result.mechanical_diagram_path = mechanical_diagram
            result.parsed_specs = parsed_specs
            
            if mechanical_diagram:
                print(f"✅ Mechanical diagram extracted: {Path(mechanical_diagram).name}")
            if parsed_specs:
                dims = parsed_specs.get('package_dimensions', {})
                print(f"   Parsed dimensions: {dims.get('length_mm')} × {dims.get('width_mm')} mm")
        
        # STEP 4: CV Tool Analysis
        print(f"\n🔧 STEP 4: CV Tool Analysis")
        print("-" * 80)
        
        # Dimension estimation (if we have expected dimensions from datasheet)
        print("  → Running dimension estimator...")
        dimension_dict, dim_viz = self._estimate_dimensions(ic_image_path, result)
        result.dimension_analysis = dimension_dict
        result.dimension_visualization = dim_viz
        
        # STEP 5: Gemini Visual Comparison
        print(f"\n👁️  STEP 5: Gemini Visual Analysis")
        print("-" * 80)
        visual_result = self._gemini_visual_analysis(
            ic_image_path,
            mechanical_diagram,
            parsed_specs,
            result,
            dimension_analysis=dimension_dict,  # Pass dimension analysis to Gemini
            datasheet_pdf_path=result.datasheet_path  # Pass full PDF for comprehensive analysis
        )
        result.visual_comparison = visual_result
        result.anomalies = visual_result.get('anomalies', [])
        
        # STEP 6: Final Verdict
        print(f"\n⚖️  STEP 6: Final Verdict Calculation")
        print("-" * 80)
        self._calculate_verdict(result)
        
        # STEP 7: Generate Report
        print(f"\n📄 STEP 7: Report Generation")
        print("-" * 80)
        report_path = self._generate_report(result)
        result.report_path = report_path  # Store in result object
        
        result.processing_time_seconds = time.time() - start_time
        
        print(f"\n{'='*80}")
        print(f"DETECTION COMPLETE")
        print(f"{'='*80}")
        print(f"Verdict: {result.verdict}")
        print(f"Authenticity Score: {result.authenticity_score:.1f}/100")
        print(f"Processing Time: {result.processing_time_seconds:.2f}s")
        print(f"Report: {report_path}")
        print(f"{'='*80}\n")
        
        return result
    
    def _identify_ic(self, image_path: Path, additional_info: Optional[str] = None, all_images: Optional[List[Path]] = None) -> Dict:
        """Step 1: Identify IC using Gemini VLM
        
        Args:
            image_path: Primary image path
            additional_info: Optional additional information about the IC
            all_images: Optional list of all image paths (multiple views)
        """
        try:
            # Use primary image for identification, but can be enhanced to use all images
            ic_info = identify_ic(self.identifier_model, str(image_path), additional_info=additional_info)
            
            # If multiple images provided, note it in the info
            if all_images and len(all_images) > 1:
                ic_info['multiple_views'] = True
                ic_info['view_count'] = len(all_images)
            
            return ic_info
        except Exception as e:
            print(f"⚠️  Identification failed: {e}")
            return {
                'part_number': 'UNKNOWN',
                'manufacturer': 'UNKNOWN',
                'package_type': 'UNKNOWN',
                'pin_count': 0
            }
    
    def _scrape_datasheet(self, part_number: str) -> Optional[str]:
        """Step 2: Scrape datasheet from web"""
        try:
            scraper = DatasheetScraper(output_dir=str(self.output_dir / "datasheets"))
            result = scraper.scrape(part_number)
            
            if result and result.get('pdf_path'):
                return result['pdf_path']
            return None
        except Exception as e:
            print(f"⚠️  Scraping failed: {e}")
            return None
    
    def _parse_datasheet(self, pdf_path: str, part_number: str, 
                         package_type: str, pin_count: int, manufacturer: str = None) -> Tuple[Optional[str], Optional[Dict]]:
        """Step 3: Parse datasheet and extract mechanical diagram + specs"""
        try:
            parser = DatasheetParser(pdf_path, output_dir=str(self.output_dir / "diagrams"))
            info = parser.parse(part_number, package_type, pin_count, manufacturer=manufacturer)
            
            # Save parsed info as JSON
            json_path = parser.save_summary(info)
            
            # FIRST: Try to use Gemini to identify the correct outline diagram page
            gemini_page_num = self._identify_outline_page_with_gemini(
                pdf_path, part_number, package_type, pin_count
            )
            
            best_diagram = None
            best_page_num = None
            
            if gemini_page_num:
                # Gemini found a page - extract it specifically
                print(f"  → Using Gemini-identified page {gemini_page_num}")
                try:
                    import fitz  # PyMuPDF
                    with fitz.open(pdf_path) as doc:
                        if 1 <= gemini_page_num <= len(doc):
                            page = doc[gemini_page_num - 1]
                            # Extract page as image
                            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x zoom for better quality
                            output_path = self.output_dir / "diagrams" / f"{part_number}_tavily_mechanical_{package_type}_page{gemini_page_num}.png"
                            output_path.parent.mkdir(parents=True, exist_ok=True)
                            pix.save(str(output_path))
                            best_diagram = str(output_path)
                            best_page_num = gemini_page_num
                            print(f"  ✓ Extracted Gemini-identified page {gemini_page_num}")
                            pix = None  # Clean up pixmap
                except Exception as e:
                    print(f"  ⚠️  Failed to extract Gemini-identified page: {e}")
                    import traceback
                    traceback.print_exc()
                    gemini_page_num = None  # Fall back to scoring
            
            # If Gemini didn't find a page, use scoring-based selection
            if not best_diagram and info.mechanical_diagrams:
                import re
                import pdfplumber
                
                scored_pages = []
                
                with pdfplumber.open(pdf_path) as pdf:
                    for diagram in info.mechanical_diagrams:
                        # Extract page number
                        page_match = re.search(r'page(\d+)', diagram)
                        if not page_match:
                            continue
                        page_num = int(page_match.group(1))
                        
                        # Read page content
                        page = pdf.pages[page_num - 1]
                        text = page.extract_text() or ""
                        text_lower = text.lower()
                        
                        score = 0
                        
                        # Boost image-only pages (likely actual diagrams, not text/tables)
                        if len(text.strip()) < 50:
                            score += 80
                            print(f"    Page {page_num}: Image-only page (+80 base score)")
                        
                        # High priority: actual package outline diagram
                        if 'package outline' in text_lower or 'package drawing' in text_lower:
                            score += 100
                        
                        # Has dimensions table
                        if 'mechanical data' in text_lower and 'symbol' in text_lower:
                            score += 50
                        
                        # Has figure/diagram
                        if 'figure' in text_lower:
                            score += 30
                        
                        # Boost pages that come right after "MECHANICAL DATA" header
                        if page_num > 1:
                            prev_page = pdf.pages[page_num - 2]
                            prev_text = prev_page.extract_text() or ''
                            if 'mechanical data' in prev_text.lower() and len(prev_text.strip()) < 100:
                                score += 50
                                print(f"    Page {page_num}: Follows MECHANICAL DATA header (+50)")
                        
                        # HEAVILY penalize revision history or index pages
                        revision_keywords = [
                            'revision history', 'document revision', 'rev.', 'revision',
                            'document change', 'change history', 'document history',
                            'rev 7766', 'rev 7766g', 'rev 7766f', 'rev 7766e'  # Common revision patterns
                        ]
                        if any(keyword in text_lower for keyword in revision_keywords):
                            score -= 500  # Heavy penalty
                            print(f"    Page {page_num}: Revision history page (-500 penalty)")
                        
                        # Check for revision patterns in page numbers or headers
                        if re.search(r'rev\.?\s*\d+[a-z]?', text_lower[:200]):  # Check first 200 chars
                            score -= 300
                            print(f"    Page {page_num}: Contains revision pattern (-300 penalty)")
                        
                        # Penalize pages that are mostly revision notes
                        if 'updated the' in text_lower and 'on page' in text_lower:
                            score -= 400
                            print(f"    Page {page_num}: Revision notes page (-400 penalty)")
                        
                        # Penalize packaging materials pages (NOT IC dimensions)
                        if 'package materials' in text_lower or 'tape and reel' in text_lower:
                            score -= 200
                        
                        # Penalize land pattern pages (less useful than outline)
                        if 'land pattern' in text_lower:
                            score -= 10
                        
                        scored_pages.append((score, page_num, diagram))
                
                # Sort by score (descending)
                scored_pages.sort(reverse=True)
                
                if scored_pages:
                    best_score, best_page_num, best_diagram = scored_pages[0]
                    print(f"  → Selected best diagram using scoring: page {best_page_num} (score: {best_score})")
            
            # Re-parse dimensions from the selected page (either Gemini-identified or scored)
            if best_page_num:
                print(f"  → Re-parsing dimensions from page {best_page_num}...")
                parser._parse_package_dimensions(info, selected_page=best_page_num)
                
                # Save updated summary
                json_path = parser.save_summary(info)
            
            # Fallback: Use first available diagram if best_diagram is None
            if not best_diagram and info.mechanical_diagrams:
                best_diagram = info.mechanical_diagrams[0]
                print(f"  → Using first available mechanical diagram: {Path(best_diagram).name}")
            
            # Convert info to dict for Gemini
            parsed_data = {
                'package_dimensions': {
                    'length_mm': info.package_dimensions.length_mm,
                    'width_mm': info.package_dimensions.width_mm,
                    'height_mm': info.package_dimensions.height_mm,
                    'pin_count': info.package_dimensions.pin_count,
                    'pin_pitch_mm': info.package_dimensions.pin_pitch_mm,
                    'package_type': info.package_dimensions.package_type
                },
                'manufacturer': info.manufacturer,
                'physical_features': info.features
            }
            
            return best_diagram, parsed_data
        except Exception as e:
            print(f"⚠️  Parsing failed: {e}")
            return None, None
    
    def _identify_outline_page_with_gemini(self, pdf_path: str, part_number: str, 
                                          package_type: str, pin_count: int) -> Optional[int]:
        """Use Gemini to identify the correct outline dimension page from the full PDF
        
        Args:
            pdf_path: Path to full PDF datasheet
            part_number: IC part number
            package_type: Target package type (e.g., "TQFP", "DIP", "QFN")
            pin_count: Expected pin count
            
        Returns:
            Page number (1-indexed) of the outline diagram, or None if not found
        """
        try:
            print("  → Asking Gemini to identify correct outline diagram page from PDF...")
            
            # Ensure PDF path is absolute and exists
            pdf_path_obj = Path(pdf_path)
            pdf_path_abs = pdf_path_obj.resolve()
            if not pdf_path_abs.exists():
                raise FileNotFoundError(f"PDF file not found: {pdf_path_abs}")
            
            # Upload PDF using absolute path
            uploaded_file = genai.upload_file(path=str(pdf_path_abs))
            
            prompt = f"""You are analyzing a datasheet PDF for the IC part number: {part_number}

**Target Package:**
- Package Type: {package_type}
- Pin Count: {pin_count}

**Your Task:**
Scan through the ENTIRE PDF and identify the page number that contains the **OUTLINE DIMENSION** or **PACKAGE OUTLINE** diagram for the {package_type} package with {pin_count} pins.

**What to look for:**
- Pages with mechanical/outline dimension drawings
- Pages showing package dimensions (length, width, height) in millimeters
- Pages with technical drawings showing pin layout and spacing
- Pages titled "Package Outline", "Mechanical Dimensions", "Outline Dimensions", etc.

**What to AVOID:**
- Revision history pages (pages with "Rev.", "Revision History", "Document Revision")
- Pages that only show text changes or update notes
- Packaging/taping/reel information pages
- Land pattern pages (unless they also contain outline dimensions)

**Output Format (JSON only):**
```json
{{
  "outline_page_number": <page number (1-indexed) or null>,
  "confidence": "high|medium|low",
  "reasoning": "Brief explanation of why this page was selected"
}}
```

If you cannot find a suitable outline dimension page, return null for outline_page_number.
"""
            
            response = self.analysis_model.generate_content([prompt, uploaded_file])
            
            # Parse JSON response
            import re
            json_match = re.search(r'\{[^{}]*"outline_page_number"[^{}]*\}', response.text, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                page_num = result.get('outline_page_number')
                confidence = result.get('confidence', 'unknown')
                reasoning = result.get('reasoning', '')
                
                if page_num:
                    print(f"  ✓ Gemini identified outline diagram on page {page_num} (confidence: {confidence})")
                    if reasoning:
                        print(f"    Reasoning: {reasoning}")
                    return int(page_num)
                else:
                    print(f"  ⚠️  Gemini could not identify outline diagram page")
                    return None
            else:
                print(f"  ⚠️  Could not parse Gemini response: {response.text[:200]}")
                return None
                
        except Exception as e:
            print(f"  ⚠️  Gemini page identification failed: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _extract_dimensions_with_gemini(self, diagram_path: str) -> Optional[Dict]:
        """Use Gemini VLM to extract dimensions from mechanical diagram
        
        Args:
            diagram_path: Path to mechanical diagram image
            
        Returns:
            Dict with extracted dimensions or None if extraction fails
        """
        try:
            from PIL import Image
            diagram_image = Image.open(diagram_path)
            
            prompt = """You are analyzing a mechanical package drawing for an integrated circuit.

**Your Task:**
Extract the following dimensions from this technical drawing. Look for dimension annotations with measurements in millimeters (mm) or inches (convert to mm if needed, 1 inch = 25.4 mm).

**Focus on:**
1. **Body Length** - The longest dimension of the IC package body (excluding pins)
2. **Body Width** - The shorter dimension of the IC package body (excluding pins)
3. **Height/Thickness** - The package height/thickness (if shown)
4. **Pin Count** - Total number of pins/leads
5. **Pin Pitch** - Distance between pin centers (typically 1.27mm, 2.54mm, etc.)
6. **Package Type** - DIP, SOIC, QFP, QFN, BGA, etc.

**Output Format (JSON only, no explanation):**
```json
{{
  "body_length_mm": <number or null>,
  "body_width_mm": <number or null>,
  "height_mm": <number or null>,
  "pin_count": <number or null>,
  "pin_pitch_mm": <number or null>,
  "package_type": "<string or null>"
}}
```

If you cannot find a specific dimension, use null. Be precise with numbers.
"""
            
            response = self.analysis_model.generate_content([prompt, diagram_image])
            
            # Parse JSON response
            response_text = response.text
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
            else:
                json_str = response_text.strip()
            
            extracted = json.loads(json_str)
            
            # Validate extracted data
            if extracted.get('body_length_mm') and extracted.get('body_width_mm'):
                print(f"  ✓ Gemini extracted dimensions: {extracted['body_length_mm']} × {extracted['body_width_mm']} mm")
                if extracted.get('pin_count'):
                    print(f"    Pin count: {extracted['pin_count']}, Pitch: {extracted.get('pin_pitch_mm', '?')} mm")
                return extracted
            else:
                print(f"  ⚠️  Gemini extraction incomplete: {extracted}")
                return None
                
        except Exception as e:
            print(f"  ✗ Gemini dimension extraction failed: {e}")
            return None
    
    def _estimate_dimensions(self, image_path: Path, result: DetectionResult) -> Tuple[Dict, Optional[str]]:
        """Step 4a: Estimate dimensions using CV tool
        
        Returns:
            (dimension_dict, visualization_path)
        """
        try:
            # Get expected dimensions from Gemini extraction or datasheet parser
            expected_length = None
            expected_width = None
            dimension_source = None
            
            # Priority 1: Try Gemini extraction from mechanical diagram
            if result.mechanical_diagram_path:
                print(f"  → Attempting Gemini dimension extraction from diagram...")
                gemini_dims = self._extract_dimensions_with_gemini(result.mechanical_diagram_path)
                
                if gemini_dims:
                    expected_length = gemini_dims.get('body_length_mm')
                    expected_width = gemini_dims.get('body_width_mm')
                    dimension_source = "gemini_extraction"
                    
                    # Update parsed_specs with Gemini's extraction for later use
                    if result.parsed_specs is None:
                        result.parsed_specs = {}
                    if 'package_dimensions' not in result.parsed_specs:
                        result.parsed_specs['package_dimensions'] = {}
                    
                    result.parsed_specs['package_dimensions'].update({
                        'length_mm': expected_length,
                        'width_mm': expected_width,
                        'height_mm': gemini_dims.get('height_mm'),
                        'pin_count': gemini_dims.get('pin_count'),
                        'pin_pitch_mm': gemini_dims.get('pin_pitch_mm'),
                        'package_type': gemini_dims.get('package_type')
                    })
            
            # Priority 2: Use parsed specs from datasheet parser
            if (not expected_length or not expected_width) and result.parsed_specs:
                dims = result.parsed_specs.get('package_dimensions', {})
                expected_length = dims.get('length_mm')
                expected_width = dims.get('width_mm')
                if expected_length and expected_width:
                    dimension_source = "datasheet_parser"
            
            # If no ground truth dimensions available, still run estimator for measured values
            if not expected_length or not expected_width:
                print(f"  ⚠️  No ground truth dimensions available from datasheet or Gemini extraction.")
                print(f"     Running dimension estimator anyway - will provide measured aspect ratio for Gemini analysis.")
                dimension_source = "no_ground_truth"
            
            # Always run dimension estimator (works with or without expected dimensions)
            dim_result = estimate_dimensions(
                str(image_path),
                expected_length,  # Can be None - estimator handles this
                expected_width    # Can be None - estimator handles this
            )
            
            # Generate visualization - save directly to output directory to avoid duplication
            from tools.dimension_estimator import visualize_dimensions
            # Ensure image_path is a Path object for .stem attribute
            image_path_obj = Path(image_path) if not isinstance(image_path, Path) else image_path
            viz_path = str(self.output_dir / f"dimension_analysis_{image_path_obj.stem}.png")
            # Pass output_path directly to avoid creating duplicate files
            visualize_dimensions(str(image_path), dim_result, output_path=viz_path)
            
            # Convert DimensionResult to dict
            body_bbox = [b for b in dim_result.bboxes if b['type'] == 'ic_body'][0] if dim_result.bboxes else {}
            dim_dict = {
                'measured_aspect_ratio': dim_result.measured_aspect_ratio,
                'expected_aspect_ratio': dim_result.expected_aspect_ratio,
                'confidence_score': dim_result.dimension_score,
                'bboxes': dim_result.bboxes,
                'body_width_px': body_bbox.get('w', dim_result.body_width_px),
                'body_height_px': body_bbox.get('h', dim_result.body_height_px),
                'verdict': dim_result.verdict,
                'dimension_source': dimension_source,  # Track where dimensions came from
                'expected_length_mm': expected_length,
                'expected_width_mm': expected_width
            }
            
            print(f"  ✓ Dimension analysis complete (source: {dimension_source})")
            if expected_length and expected_width:
                print(f"    Expected: {expected_length} × {expected_width} mm (AR: {dim_dict['expected_aspect_ratio']:.2f})")
            else:
                print(f"    No ground truth available - measured values only")
            print(f"    Measured: AR = {dim_dict['measured_aspect_ratio']:.2f}")
            print(f"    Score: {dim_dict['confidence_score']:.1f}/100")
            print(f"    Visualization saved: {Path(viz_path).name}")
            
            return dim_dict, viz_path
        except Exception as e:
            print(f"  ✗ Dimension estimation failed: {e}")
            import traceback
            traceback.print_exc()
            return {}, None
    
    def _gemini_visual_analysis(self, ic_image_path: Path, 
                                mechanical_diagram: Optional[str],
                                parsed_specs: Optional[Dict],
                                result: DetectionResult,
                                dimension_analysis: Optional[Dict] = None,
                                datasheet_pdf_path: Optional[str] = None,
                                all_images: Optional[List[Path]] = None,
                                additional_info: Optional[str] = None) -> Dict:
        """Step 5: Gemini visual comparison and anomaly detection
        
        Args:
            datasheet_pdf_path: Optional path to full PDF datasheet for Gemini to analyze entirely
            all_images: Optional list of all IC image paths (multiple views)
            additional_info: Optional additional information about the IC
        """
        
        try:
            # Load primary IC image
            ic_image = Image.open(ic_image_path)
            
            # Build prompt with parsed specs and dimension analysis
            prompt = self._build_analysis_prompt(result, mechanical_diagram is not None, parsed_specs, dimension_analysis, datasheet_pdf_path is not None, additional_info=additional_info)
            
            # Build content list - start with prompt and primary image
            content = [prompt, ic_image]
            
            # Add additional images if provided (multiple views)
            if all_images and len(all_images) > 1:
                content.append("\n\nADDITIONAL IC VIEWS (Multiple angles/perspectives):")
                for idx, img_path in enumerate(all_images[1:], 2):  # Skip first (already added)
                    try:
                        additional_img = Image.open(img_path)
                        content.append(f"\nView {idx}:")
                        content.append(additional_img)
                    except Exception as e:
                        print(f"  ⚠️  Failed to load additional image {img_path}: {e}")
            
            # If we have the full PDF, upload it to Gemini for complete analysis
            if datasheet_pdf_path:
                pdf_path_obj = Path(datasheet_pdf_path)
                # Resolve to absolute path and verify it exists
                pdf_path_abs = pdf_path_obj.resolve()
                if pdf_path_abs.exists():
                    print("  → Uploading full PDF datasheet to Gemini for complete analysis...")
                    try:
                        # Use absolute path for upload
                        uploaded_file = genai.upload_file(path=str(pdf_path_abs))
                        print(f"  ✓ PDF uploaded: {uploaded_file.uri}")
                        content.append(f"\n\nFULL OEM DATASHEET PDF (uploaded):")
                        content.append(uploaded_file)
                        print("  → Gemini will analyze the entire PDF for comprehensive comparison...")
                    except Exception as pdf_err:
                        print(f"  ⚠️  PDF upload failed ({pdf_err}), falling back to extracted diagram")
                        import traceback
                        traceback.print_exc()
                        datasheet_pdf_path = None  # Fallback to diagram
                else:
                    print(f"  ⚠️  PDF file not found at {pdf_path_abs}, falling back to extracted diagram")
                    datasheet_pdf_path = None
            
            # If we have mechanical diagram (and didn't upload full PDF), include it
            if mechanical_diagram and not datasheet_pdf_path:
                diagram_image = Image.open(mechanical_diagram)
                content.append("\n\nDATASHEET MECHANICAL DIAGRAM:")
                content.append(diagram_image)
            
            # Add parsed specs as JSON (always include for reference)
            if parsed_specs:
                content.append("\n\nPARSED DATASHEET SPECIFICATIONS (JSON):")
                content.append(json.dumps(parsed_specs, indent=2))
            
            # Add dimension analysis as JSON
            if dimension_analysis:
                content.append("\n\nCV DIMENSION ANALYSIS RESULTS (JSON):")
                content.append(json.dumps(dimension_analysis, indent=2))
            
            if datasheet_pdf_path:
                print("  → Comparing IC image with full datasheet PDF...")
            elif mechanical_diagram:
                print("  → Comparing IC image with datasheet (diagram + specs)...")
            else:
                print("  → Analyzing IC image (no datasheet available)...")
            
            response = self.analysis_model.generate_content(content)
            
            # Parse response
            analysis = self._parse_gemini_response(response.text)
            
            print(f"  ✓ Visual analysis complete")
            print(f"    Anomalies detected: {len(analysis.get('anomalies', []))}")
            
            return analysis
            
        except Exception as e:
            print(f"  ✗ Visual analysis failed: {e}")
            return {'anomalies': [], 'observations': str(e)}
    
    def _build_analysis_prompt(self, result: DetectionResult, has_diagram: bool, parsed_specs: Optional[Dict] = None, dimension_analysis: Optional[Dict] = None, has_full_pdf: bool = False, additional_info: Optional[str] = None) -> str:
        """Build prompt for Gemini visual analysis"""
        
        base_prompt = f"""You are an expert in counterfeit IC detection. Analyze this IC image for authenticity.

**IC Information:**
- Part Number: {result.part_number}
- Manufacturer: {result.manufacturer}
- Package: {result.package_type} ({result.pin_count}-pin)
"""
        
        # Add additional info if provided
        if additional_info:
            base_prompt += f"""
**Additional Context (User Provided):**
{additional_info}
"""
        
        # Note if multiple views are available
        if result.ic_image_paths and len(result.ic_image_paths) > 1:
            base_prompt += f"""
**Note:** Multiple views ({len(result.ic_image_paths)} images) of this IC are provided. Analyze all views comprehensively and consider different angles/perspectives in your assessment.
"""

        if parsed_specs:
            dims = parsed_specs.get('package_dimensions', {})
            base_prompt += f"""
**Expected Specifications (from datasheet):**
- Package Type: {dims.get('package_type', 'N/A')}
- Dimensions: {dims.get('length_mm', '?')} × {dims.get('width_mm', '?')} mm
- Height: {dims.get('height_mm', '?')} mm
- Pin Count: {dims.get('pin_count', '?')}
- Pin Pitch: {dims.get('pin_pitch_mm', '?')} mm
"""

        if dimension_analysis:
            expected_ar = dimension_analysis.get('expected_aspect_ratio')
            expected_length = dimension_analysis.get('expected_length_mm')
            expected_width = dimension_analysis.get('expected_width_mm')
            dimension_source = dimension_analysis.get('dimension_source', 'unknown')
            
            base_prompt += f"""
**CV Dimension Analysis Results:**
- Measured Aspect Ratio: {dimension_analysis.get('measured_aspect_ratio', '?'):.2f}"""
            
            if expected_ar is not None:
                base_prompt += f"""
- Expected Aspect Ratio: {expected_ar:.2f} (from {dimension_source})
- Expected Dimensions: {expected_length} × {expected_width} mm
- Dimension Match Score: {dimension_analysis.get('confidence_score', '?'):.1f}/100
- Verdict: {dimension_analysis.get('verdict', 'UNKNOWN')}

**Note:** Use this CV analysis to inform your assessment. If the dimension score is low, investigate why (wrong package type identification, orientation, or actual dimensional mismatch).
"""
            else:
                base_prompt += f"""
- Expected Aspect Ratio: N/A (no ground truth available - datasheet dimensions not extracted)
- Dimension Source: {dimension_source}

**Note:** No ground truth dimensions available for comparison. Use the measured aspect ratio ({dimension_analysis.get('measured_aspect_ratio', '?'):.2f}) to assess if it's reasonable for the identified package type ({result.package_type}). An absurd aspect ratio (e.g., extremely elongated or square when it should be the opposite) could indicate a counterfeit.
"""

        base_prompt += """
**Your Task (explicit checklist):**
1) Count pins in the IC photo and compare to the datasheet pin count; flag any mismatch.
2) Check pin pitch and row-to-row spacing vs datasheet/diagram; note alignment/warping.
3) Verify package type and outline (DIP/SOIC/QFN/QFP/BGA, corners/chamfer, exposed pad presence/size).
4) Verify pin-1 indicator (dot/notch/bevel) location matches the datasheet diagram orientation.
5) Compare body dimensions/aspect ratio to datasheet/diagram (use CV dimension analysis above); flag implausible ratios.
6) Validate markings: part number, manufacturer/logo style/placement, font weight/kerning, line layout, date/lot code format/placement.
7) For QFN/BGA: check pad/ball grid dimensions, exposed pad alignment, ball/pad count vs diagram.
8) Assess surface texture/erosion/remarking (uniformity, sanding signs).
"""

        if has_full_pdf:
            base_prompt += """9) Cross-check IC photo with the FULL OEM DATASHEET PDF provided:
   - Review ALL mechanical diagram pages (not just the selected one)
   - Check for the correct package variant (avoid revision history pages)
   - Verify dimensions from the actual outline dimension pages
   - Compare pin configurations, markings, and physical specifications
   - The full PDF gives you complete context - use it comprehensively
   
10) Cross-check IC photo with parsed specs JSON (provided for quick reference):
- Pin count, pin pitch, and layout match
- Package outline/size and orientation match
- Marking placement relative to notch/pin-1 is consistent
- Use CV dimension analysis above as supporting evidence
"""
        elif has_diagram:
            base_prompt += """9) Cross-check IC photo with datasheet mechanical diagram AND parsed specs:
- Pin count, pin pitch, and layout match
- Package outline/size and orientation match
- Marking placement relative to notch/pin-1 is consistent
- Use CV dimension analysis above as supporting evidence
"""

        base_prompt += """
**Output Format (JSON):**
```json
{
  "observations": [
    "Observation 1",
    "Observation 2"
  ],
  "anomalies": [
    {
      "type": "text_quality|surface_texture|pin_alignment|dimensions|marking",
      "severity": "high|medium|low",
      "description": "Detailed description",
      "bbox": [x1, y1, x2, y2],
      "confidence": 0.0-1.0
    }
  ],
  "pin_count_verified": true/false,
  "package_type_verified": true/false,
  "text_quality_score": 0-100,
  "overall_assessment": "authentic|suspicious|counterfeit",
  "reasoning": "Detailed reasoning for the assessment"
}
```

Provide bounding boxes [x1, y1, x2, y2] as normalized coordinates (0.0-1.0) for any anomalies.
"""
        
        return base_prompt
    
    def _parse_gemini_response(self, response_text: str) -> Dict:
        """Parse Gemini's JSON response"""
        try:
            # Extract JSON from markdown code blocks
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
            else:
                json_str = response_text
            
            return json.loads(json_str)
        except Exception as e:
            print(f"  ⚠️  Failed to parse JSON response: {e}")
            # Return fallback structure
            return {
                'observations': [response_text[:200]],
                'anomalies': [],
                'overall_assessment': 'unknown',
                'reasoning': 'Failed to parse structured response'
            }
    
    def _calculate_verdict(self, result: DetectionResult):
        """Step 6: Calculate final verdict based on all analyses
        
        Scoring weights:
        - Dimension analysis: 50% (increased from 30%) - critical physical measurements
        - Visual analysis: 30% (decreased from 50%) - subjective visual inspection
        - Anomaly penalty: up to 30 points deduction
        """
        
        scores = []
        weights = []
        
        # Dimension analysis score (INCREASED WEIGHT: 50%)
        if result.dimension_analysis:
            dim_data = result.dimension_analysis
            dim_score = dim_data.get('confidence_score', 50)
            
            # Apply additional penalties based on dimension verdict
            dim_verdict = dim_data.get('verdict', 'UNKNOWN')
            aspect_match = dim_data.get('aspect_ratio_match', None)
            aspect_error = dim_data.get('aspect_ratio_error_percent', None)
            
            # Critical: If dimensions don't match, heavily penalize
            if dim_verdict == 'MISMATCH' or (aspect_match is False):
                # If aspect ratio error > 10%, this is a major red flag
                if aspect_error is not None and aspect_error > 10:
                    dim_score = max(0, dim_score - 30)  # Heavy penalty for dimension mismatch
                elif aspect_error is not None and aspect_error > 5:
                    dim_score = max(0, dim_score - 15)  # Moderate penalty
                elif aspect_error is None:
                    # If verdict is MISMATCH but no error data, still penalize
                    dim_score = max(0, dim_score - 20)
            
            # Boost score if dimensions match well
            if dim_verdict == 'MATCH' and (aspect_match is True) and (aspect_error is not None and aspect_error < 3):
                dim_score = min(100, dim_score + 5)  # Small boost for excellent match
            
            scores.append(dim_score)
            weights.append(0.5)  # Increased from 0.3 to 0.5
        
        # Visual analysis score (DECREASED WEIGHT: 30%)
        if result.visual_comparison:
            visual_assessment = result.visual_comparison.get('overall_assessment', 'unknown')
            text_quality = result.visual_comparison.get('text_quality_score', 50)
            
            # Convert assessment to score
            assessment_scores = {
                'authentic': 90,
                'suspicious': 50,
                'counterfeit': 10,
                'unknown': 50
            }
            visual_score = (assessment_scores.get(visual_assessment, 50) + text_quality) / 2
            scores.append(visual_score)
            weights.append(0.3)  # Decreased from 0.5 to 0.3
        
        # Anomaly penalty
        anomaly_count = len(result.anomalies)
        high_severity_count = sum(1 for a in result.anomalies if a.get('severity') == 'high')
        anomaly_penalty = min(30, anomaly_count * 5 + high_severity_count * 10)
        
        # Calculate weighted score
        if scores:
            weighted_sum = sum(s * w for s, w in zip(scores, weights))
            total_weight = sum(weights)
            base_score = weighted_sum / total_weight
        else:
            base_score = 50
        
        final_score = max(0, base_score - anomaly_penalty)
        result.authenticity_score = round(final_score, 1)
        
        # Determine verdict
        if final_score >= 75:
            result.verdict = "LIKELY AUTHENTIC"
        elif final_score >= 50:
            result.verdict = "SUSPICIOUS"
        else:
            result.verdict = "LIKELY COUNTERFEIT"
        
        # Build reasoning with more detail about dimension analysis
        reasoning_parts = []
        
        if result.dimension_analysis:
            dim_data = result.dimension_analysis
            dim_score = dim_data.get('confidence_score', 0)
            dim_verdict = dim_data.get('verdict', 'UNKNOWN')
            aspect_match = dim_data.get('aspect_ratio_match', None)
            aspect_error = dim_data.get('aspect_ratio_error_percent', None)
            
            dim_reason = f"Dimensional analysis: {dim_score:.1f}/100"
            if dim_verdict != 'UNKNOWN':
                dim_reason += f" (verdict: {dim_verdict})"
            if aspect_error is not None:
                dim_reason += f" (error: {aspect_error:.1f}%)"
            reasoning_parts.append(dim_reason)
        
        if result.visual_comparison:
            reasoning_parts.append(
                f"Visual assessment: {result.visual_comparison.get('overall_assessment', 'unknown')}"
            )
        
        if anomaly_count > 0:
            reasoning_parts.append(
                f"{anomaly_count} anomalies detected ({high_severity_count} high severity)"
            )
        
        result.reasoning = "; ".join(reasoning_parts)
        
        print(f"  Final Score: {result.authenticity_score}/100")
        print(f"  Verdict: {result.verdict}")
        
        # Print scoring weights breakdown
        weight_info = []
        if result.dimension_analysis:
            weight_info.append(f"Dimension={weights[0]*100:.0f}%")
        if result.visual_comparison and len(weights) > (1 if result.dimension_analysis else 0):
            idx = 1 if result.dimension_analysis else 0
            weight_info.append(f"Visual={weights[idx]*100:.0f}%")
        if weight_info:
            print(f"  Scoring weights: {', '.join(weight_info)}")
    
    def _generate_report(self, result: DetectionResult) -> str:
        """Step 7: Generate PDF report with bboxes and analysis"""
        
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_filename = f"detection_report_{Path(result.ic_image_path).stem}_{timestamp_str}.pdf"
        report_path = self.output_dir / report_filename
        
        # Create annotated images (one per anomaly)
        annotated_images = self._create_annotated_images(result)
        
        # Track section boundary - we'll count pages as we build
        # Section 1 (OEM) typically takes 1-2 pages, Section 2 (Final Report) starts after PageBreak
        oem_pages_estimate = 2  # Estimate: OEM section is usually 1-2 pages
        
        # Page numbering callback
        def add_page_number(canv, doc):
            page_num = canv.getPageNumber()
            
            # Determine section based on page number
            # Section 1 (OEM datasheet): pages 1-2 (typically)
            # Section 2 (Final report): pages 3+
            # This is a reasonable estimate since OEM section is usually 1-2 pages
            if page_num <= oem_pages_estimate:
                section_num = 1
            else:
                section_num = 2
            
            # Draw page number at bottom right
            canv.saveState()
            canv.setFont("Helvetica", 9)
            canv.setFillColor(colors.grey)
            page_text = f"{section_num}/2"
            page_width = letter[0]
            canv.drawRightString(page_width - 0.5*inch, 0.5*inch, page_text)
            canv.restoreState()
        
        # Build PDF with page template
        doc = BaseDocTemplate(str(report_path), pagesize=letter)
        styles = getSampleStyleSheet()
        
        # Create frame for content
        frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, 
                     leftPadding=0, bottomPadding=0, rightPadding=0, topPadding=0)
        template = PageTemplate(id='normal', frames=frame, onPage=add_page_number)
        doc.addPageTemplates([template])
        
        story = []
        
        # ========== SECTION 1: OEM DATASHEET (Page 1/2) ==========
        # Mechanical Diagram (Outline Dimension Page) with Dimensions Table and Download
        if result.mechanical_diagram_path and Path(result.mechanical_diagram_path).exists():
            story.append(Paragraph("DATASHEET OUTLINE DIMENSION PAGE", styles['Heading2']))
            story.append(Spacer(1, 0.1*inch))
            
            # Add description
            story.append(Paragraph(
                "The following page shows the exact mechanical outline diagram extracted from the OEM datasheet. "
                "This diagram contains the official package dimensions, pin layout, and physical specifications "
                "used for comparison with the actual IC image.",
                styles['Normal']
            ))
            story.append(Spacer(1, 0.15*inch))
            
            # Extract dimensions from mechanical diagram if not already extracted
            extracted_dims = None
            if result.parsed_specs and result.parsed_specs.get('package_dimensions'):
                # Use already extracted dimensions
                extracted_dims = result.parsed_specs['package_dimensions']
            else:
                # Try to extract dimensions now
                print("  → Extracting dimensions from mechanical diagram for report...")
                extracted_dims = self._extract_dimensions_with_gemini(result.mechanical_diagram_path)
                if extracted_dims:
                    # Store for later use
                    if result.parsed_specs is None:
                        result.parsed_specs = {}
                    result.parsed_specs['package_dimensions'] = extracted_dims
            
            # Show diagram (ensure it fits within page margins)
            try:
                # Use proportional scaling to ensure it fits
                diagram_img = RLImage(result.mechanical_diagram_path, width=5.5*inch, height=8*inch, kind='proportional')
                story.append(diagram_img)
                story.append(Spacer(1, 0.2*inch))
            except Exception as e:
                print(f"  ⚠️  Failed to load diagram image: {e}")
                story.append(Paragraph(f"<i>Diagram image could not be loaded: {str(e)}</i>", styles['Normal']))
                story.append(Spacer(1, 0.2*inch))
            
            # Dimensions Table (if extracted)
            if extracted_dims:
                story.append(Paragraph("EXTRACTED DIMENSIONS FROM DIAGRAM", styles['Heading3']))
                story.append(Spacer(1, 0.08*inch))
                story.append(Paragraph(
                    "The following dimensions were extracted from the mechanical diagram above using AI analysis:",
                    styles['Normal']
                ))
                story.append(Spacer(1, 0.1*inch))
                
                dim_table_data = [['Parameter', 'Value']]
                
                # Add all available dimensions
                if extracted_dims.get('body_length_mm'):
                    dim_table_data.append(['Body Length', f"{extracted_dims['body_length_mm']} mm"])
                if extracted_dims.get('body_width_mm'):
                    dim_table_data.append(['Body Width', f"{extracted_dims['body_width_mm']} mm"])
                if extracted_dims.get('height_mm'):
                    dim_table_data.append(['Height/Thickness', f"{extracted_dims['height_mm']} mm"])
                if extracted_dims.get('pin_count'):
                    dim_table_data.append(['Pin Count', str(extracted_dims['pin_count'])])
                if extracted_dims.get('pin_pitch_mm'):
                    dim_table_data.append(['Pin Pitch', f"{extracted_dims['pin_pitch_mm']} mm"])
                if extracted_dims.get('package_type'):
                    dim_table_data.append(['Package Type', extracted_dims['package_type']])
                
                if len(dim_table_data) > 1:  # More than just header
                    dims_table = Table(dim_table_data, colWidths=[2.5*inch, 3.7*inch])
                    dims_table.setStyle(TableStyle([
                        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4a4a4a')),
                        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                        ('BACKGROUND', (0, 1), (0, -1), colors.HexColor('#e8e8e8')),
                        ('TEXTCOLOR', (0, 1), (0, -1), colors.HexColor('#333333')),
                        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
                        ('FONTSIZE', (0, 0), (-1, -1), 10.5),
                        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                        ('GRID', (0, 0), (-1, -1), 0.4, colors.grey),
                        ('PADDING', (0, 0), (-1, -1), 6),
                        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ]))
                    story.append(dims_table)
                    story.append(Spacer(1, 0.15*inch))
            else:
                story.append(Paragraph(
                    "<i>Note: Dimension extraction from diagram was not available. Dimensions may be available from parsed datasheet data.</i>",
                    styles['Normal']
                ))
                story.append(Spacer(1, 0.15*inch))
            
            # Download OEM Datasheet information
            if result.datasheet_path and Path(result.datasheet_path).exists():
                story.append(Paragraph("OEM DATASHEET REFERENCE", styles['Heading3']))
                story.append(Spacer(1, 0.08*inch))
                datasheet_filename = Path(result.datasheet_path).name
                
                # Create a clickable link to the datasheet
                # Extract relative path for the link
                datasheet_rel_path = str(result.datasheet_path)
                if 'api_results' in datasheet_rel_path:
                    # Extract path relative to api_results
                    parts = datasheet_rel_path.split('api_results')
                    if len(parts) > 1:
                        datasheet_rel_path = parts[-1].lstrip('/\\')
                    else:
                        # Just use the filename
                        datasheet_rel_path = datasheet_filename
                elif 'datasheets' in datasheet_rel_path:
                    # Extract from datasheets folder
                    idx = datasheet_rel_path.find('datasheets')
                    datasheet_rel_path = datasheet_rel_path[idx:]
                else:
                    datasheet_rel_path = f"datasheets/{datasheet_filename}"
                
                # Create link text with proper formatting
                link_text = f'<link href="file://{result.datasheet_path}" color="blue"><u>Download Datasheet PDF</u></link>'
                
                story.append(Paragraph(
                    f"<b>Source File:</b> {datasheet_filename}<br/>"
                    f"<b>Location:</b> {result.datasheet_path}<br/><br/>"
                    f"<b>OEM Datasheet PDF:</b><br/>"
                    f"{link_text}<br/><br/>"
                    f"<i>The complete OEM datasheet PDF is available in the detection results directory. "
                    f"This document contains the full technical specifications, electrical characteristics, "
                    f"and mechanical drawings for this IC part number.</i>",
                    styles['Normal']
                ))
                story.append(Spacer(1, 0.2*inch))
        elif result.datasheet_path and Path(result.datasheet_path).exists():
            # If no diagram but datasheet exists, still show datasheet info
            story.append(Paragraph("OEM DATASHEET REFERENCE", styles['Heading2']))
            story.append(Spacer(1, 0.1*inch))
            datasheet_filename = Path(result.datasheet_path).name
            
            # Create a clickable link to the datasheet
            link_text = f'<link href="file://{result.datasheet_path}" color="blue"><u>Download Datasheet PDF</u></link>'
            
            story.append(Paragraph(
                f"<b>Source File:</b> {datasheet_filename}<br/>"
                f"<b>Location:</b> {result.datasheet_path}<br/><br/>"
                f"<b>OEM Datasheet PDF:</b><br/>"
                f"{link_text}<br/><br/>"
                f"<i>Note: Mechanical diagram extraction was not available, but the complete OEM datasheet PDF "
                f"is available in the detection results directory.</i>",
                styles['Normal']
            ))
            story.append(Spacer(1, 0.2*inch))
        
        # Mark end of OEM section and start of final report section
        # We'll track this page number in the callback
        story.append(PageBreak())
        
        # ========== SECTION 2: FINAL REPORT (Page 2/2) ==========
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#1a1a1a'),
            spaceAfter=20,
            alignment=TA_CENTER
        )
        story.append(Paragraph("COUNTERFEIT IC DETECTION REPORT", title_style))
        story.append(Spacer(1, 0.2*inch))
        
        # Verdict box
        verdict_color = colors.green if result.authenticity_score >= 75 else \
                       colors.orange if result.authenticity_score >= 50 else colors.red
        
        verdict_data = [
            ['VERDICT', result.verdict],
            ['AUTHENTICITY SCORE', f"{result.authenticity_score}/100"],
            ['TIMESTAMP', result.timestamp[:19]]
        ]
        
        verdict_table = Table(verdict_data, colWidths=[2.5*inch, 4*inch])
        verdict_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f0f0f0')),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#333333')),
            ('TEXTCOLOR', (1, 0), (1, 0), verdict_color),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('GRID', (0, 0), (-1, -1), 1, colors.grey),
            ('PADDING', (0, 0), (-1, -1), 10),
        ]))
        story.append(verdict_table)
        story.append(Spacer(1, 0.25*inch))
        
        # IC Information
        story.append(Paragraph("IC INFORMATION", styles['Heading2']))
        ic_data = [
            ['Part Number', result.part_number],
            ['Manufacturer', result.manufacturer],
            ['Package Type', result.package_type],
            ['Pin Count', str(result.pin_count)]
        ]
        ic_table = Table(ic_data, colWidths=[2*inch, 4.5*inch])
        ic_table.setStyle(TableStyle([
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e8e8e8')),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('PADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(ic_table)
        story.append(Spacer(1, 0.25*inch))
        
        # Input IC Images Section (show all views if multiple images provided)
        if result.ic_image_paths and len(result.ic_image_paths) > 0:
            story.append(Paragraph("INPUT IC IMAGES", styles['Heading2']))
            story.append(Spacer(1, 0.1*inch))
            
            if len(result.ic_image_paths) > 1:
                story.append(Paragraph(
                    f"<b>Multiple Views Provided:</b> {len(result.ic_image_paths)} images showing different angles/perspectives of the IC.",
                    styles['Normal']
                ))
                story.append(Spacer(1, 0.15*inch))
            
            # Display all images
            for idx, img_path in enumerate(result.ic_image_paths, 1):
                try:
                    if Path(img_path).exists():
                        if len(result.ic_image_paths) > 1:
                            story.append(Paragraph(f"<b>View {idx}:</b>", styles['Heading3']))
                            story.append(Spacer(1, 0.08*inch))
                        
                        # Add image with proportional scaling
                        ic_img = RLImage(img_path, width=5.5*inch, height=4.1*inch, kind='proportional')
                        story.append(ic_img)
                        story.append(Spacer(1, 0.15*inch))
                    else:
                        story.append(Paragraph(f"<i>Image {idx} not found: {img_path}</i>", styles['Normal']))
                except Exception as e:
                    print(f"  ⚠️  Failed to load image {img_path} for report: {e}")
                    story.append(Paragraph(f"<i>Failed to load image {idx}: {str(e)}</i>", styles['Normal']))
            
            story.append(Spacer(1, 0.2*inch))
        
        # Executive Summary with Detailed Analysis
        story.append(Paragraph("EXECUTIVE SUMMARY", styles['Heading2']))
        story.append(Spacer(1, 0.1*inch))
        
        # Build comprehensive summary from visual comparison
        summary_text = ""
        if result.visual_comparison:
            visual = result.visual_comparison
            summary_text = f"<b>Overall Assessment:</b> {visual.get('overall_assessment', 'Unknown').upper()}<br/><br/>"
            
            # Text Quality Analysis
            text_quality_score = visual.get('text_quality_score', 0)
            if isinstance(text_quality_score, (int, float)):
                text_status = "✓ GOOD" if text_quality_score >= 70 else "⚠ MODERATE" if text_quality_score >= 50 else "✗ POOR"
                summary_text += f"<b>Text Quality Analysis:</b> {text_status} (Score: {text_quality_score}/100)<br/>"
                if text_quality_score >= 70:
                    summary_text += "Markings appear crisp and well-defined. Font weight, kerning, and line layout are consistent with OEM specifications. No signs of erosion or tampering detected.<br/><br/>"
                elif text_quality_score >= 50:
                    summary_text += "Markings show moderate quality. Some inconsistencies in font weight or spacing may be present. Minor erosion or wear may be visible but within acceptable limits.<br/><br/>"
                else:
                    summary_text += "Markings show poor quality with visible erosion, inconsistent font weight, or irregular spacing. Possible signs of remarking or tampering detected.<br/><br/>"
            
            # Pin Count Verification
            pin_verified = visual.get('pin_count_verified', False)
            summary_text += f"<b>Pin Count Verification:</b> {'✓ VERIFIED' if pin_verified else '✗ MISMATCH'}<br/>"
            if pin_verified:
                summary_text += f"The IC has {result.pin_count} pins, which matches the datasheet specification. Pin count is correct.<br/><br/>"
            else:
                summary_text += f"Pin count mismatch detected. Expected {result.pin_count} pins according to datasheet, but actual count differs. This is a significant indicator of potential counterfeiting.<br/><br/>"
            
            # Package Type Verification
            package_verified = visual.get('package_type_verified', False)
            summary_text += f"<b>Package Type Verification:</b> {'✓ VERIFIED' if package_verified else '✗ MISMATCH'}<br/>"
            if package_verified:
                summary_text += f"Package type ({result.package_type}) matches the datasheet specification. Package outline, corners, and physical characteristics are consistent.<br/><br/>"
            else:
                summary_text += f"Package type mismatch detected. Expected {result.package_type} but physical characteristics differ from datasheet. This indicates potential counterfeiting.<br/><br/>"
            
            # Pin Spacing/Pitch Analysis
            if visual.get('pin_pitch_verified') is not None:
                pitch_verified = visual.get('pin_pitch_verified', False)
                summary_text += f"<b>Pin Pitch/Spacing:</b> {'✓ VERIFIED' if pitch_verified else '⚠ REVIEW NEEDED'}<br/>"
                if pitch_verified:
                    summary_text += "Pin pitch and row-to-row spacing match datasheet specifications. Pins are properly aligned with no warping or misalignment detected.<br/><br/>"
                else:
                    summary_text += "Pin pitch or spacing shows discrepancies from datasheet. Alignment issues or warping may be present. Further inspection recommended.<br/><br/>"
            
            # Surface Texture Analysis
            if visual.get('surface_texture_assessment'):
                surface_assessment = visual.get('surface_texture_assessment', '')
                summary_text += f"<b>Surface Texture Analysis:</b> {surface_assessment.upper()}<br/>"
                if 'uniform' in surface_assessment.lower() or 'consistent' in surface_assessment.lower():
                    summary_text += "Surface texture appears uniform and consistent with authentic ICs. No signs of sanding, remarking, or tampering detected.<br/><br/>"
                elif 'irregular' in surface_assessment.lower() or 'inconsistent' in surface_assessment.lower():
                    summary_text += "Surface texture shows irregularities or inconsistencies. Possible signs of sanding, remarking, or surface tampering detected. This is a significant indicator of counterfeiting.<br/><br/>"
                else:
                    summary_text += f"Surface texture assessment: {surface_assessment}. Review recommended.<br/><br/>"
            
            # Observations
            observations = visual.get('observations', [])
            if observations:
                summary_text += "<b>Key Observations:</b><br/>"
                for obs in observations[:5]:  # Top 5 observations
                    summary_text += f"• {obs}<br/>"
                summary_text += "<br/>"
        
        # Add dimension analysis summary
        if result.dimension_analysis:
            dim = result.dimension_analysis
            summary_text += "<b>Dimensional Analysis:</b><br/>"
            expected_ar = dim.get('expected_aspect_ratio')
            measured_ar = dim.get('measured_aspect_ratio')
            if expected_ar and measured_ar:
                error_percent = abs(measured_ar - expected_ar) / expected_ar * 100 if expected_ar > 0 else 0
                if error_percent < 5:
                    summary_text += f"✓ Package dimensions match datasheet specifications. Measured aspect ratio ({measured_ar:.3f}) closely matches expected ({expected_ar:.3f}). Error: {error_percent:.1f}%.<br/><br/>"
                elif error_percent < 10:
                    summary_text += f"⚠ Package dimensions show minor deviation. Measured aspect ratio ({measured_ar:.3f}) differs from expected ({expected_ar:.3f}) by {error_percent:.1f}%. Within acceptable tolerance.<br/><br/>"
                else:
                    summary_text += f"✗ Package dimensions show significant deviation. Measured aspect ratio ({measured_ar:.3f}) differs from expected ({expected_ar:.3f}) by {error_percent:.1f}%. This indicates potential counterfeiting.<br/><br/>"
            elif measured_ar:
                summary_text += f"Measured aspect ratio: {measured_ar:.3f}. No ground truth available for comparison.<br/><br/>"
        
        # Add reasoning if available
        if result.reasoning:
            summary_text += f"<b>Final Reasoning:</b> {result.reasoning}<br/>"
        
        if summary_text:
            summary_para = Paragraph(summary_text, styles['Normal'])
            story.append(summary_para)
            story.append(Spacer(1, 0.2*inch))
        
        # Dimension Analysis Visualization (if available)
        if result.dimension_visualization and Path(result.dimension_visualization).exists() and result.dimension_analysis:
            story.append(PageBreak())
            story.append(Paragraph("DIMENSION ANALYSIS", styles['Heading2']))
            story.append(Spacer(1, 0.08*inch))
            
            # Image with detected bbox (ensure it fits - max 5.5 inches width)
            dim_viz = RLImage(result.dimension_visualization, width=5.5*inch, height=4.1*inch, kind='proportional')
            story.append(dim_viz)
            story.append(Spacer(1, 0.18*inch))
            
            # Dimension Analysis Table (compact)
            dim_data = result.dimension_analysis
            measured_ar = dim_data.get('measured_aspect_ratio')
            measured_ar_str = f"{measured_ar:.3f}" if isinstance(measured_ar, (int, float)) else 'N/A'
            
            dim_table_data = [
                ['Parameter', 'Value'],
                ['Measured Aspect Ratio', measured_ar_str],
                ['Body Width (px)', f"{dim_data.get('body_width_px', 'N/A')}"],
                ['Body Height (px)', f"{dim_data.get('body_height_px', 'N/A')}"],
            ]
            
            expected_ar = dim_data.get('expected_aspect_ratio')
            if expected_ar is not None and isinstance(expected_ar, (int, float)):
                expected_ar_str = f"{expected_ar:.3f}"
                if isinstance(measured_ar, (int, float)):
                    error_percent = abs(measured_ar - expected_ar) / expected_ar * 100
                    match_status = 'YES ✓' if error_percent < 10 else 'NO ✗'
                else:
                    match_status = 'N/A'
                
                dim_table_data.extend([
                    ['Expected Aspect Ratio', expected_ar_str],
                    ['Expected Length (mm)', f"{dim_data.get('expected_length_mm', 'N/A')}"],
                    ['Expected Width (mm)', f"{dim_data.get('expected_width_mm', 'N/A')}"],
                    ['Dimension Source', dim_data.get('dimension_source', 'N/A')],
                    ['Aspect Ratio Match', match_status],
                ])
            else:
                dim_table_data.append(['Dimension Source', dim_data.get('dimension_source', 'N/A')])
            
            confidence_score = dim_data.get('confidence_score')
            score_str = f"{confidence_score:.1f}/100" if isinstance(confidence_score, (int, float)) else 'N/A'
            dim_table_data.extend([
                ['Dimension Score', score_str],
                ['Verdict', dim_data.get('verdict', 'N/A')],
            ])
            
            dim_table = Table(dim_table_data, colWidths=[2.8*inch, 3.4*inch])
            dim_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4a4a4a')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('BACKGROUND', (0, 1), (0, -1), colors.HexColor('#e8e8e8')),
                ('TEXTCOLOR', (0, 1), (0, -1), colors.HexColor('#333333')),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 10.5),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('GRID', (0, 0), (-1, -1), 0.4, colors.grey),
                ('PADDING', (0, 0), (-1, -1), 6),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ]))
            story.append(dim_table)
            story.append(Spacer(1, 0.12*inch))
        
        # Detailed Visual Analysis Section
        if result.visual_comparison:
            story.append(PageBreak())
            story.append(Paragraph("DETAILED VISUAL ANALYSIS", styles['Heading2']))
            story.append(Spacer(1, 0.15*inch))
            
            visual = result.visual_comparison
            
            # Text Quality Detailed Analysis
            text_quality_score = visual.get('text_quality_score', 0)
            if isinstance(text_quality_score, (int, float)):
                story.append(Paragraph("<b>1. Text Quality Assessment</b>", styles['Heading3']))
                text_analysis = f"""
                <b>Score:</b> {text_quality_score}/100<br/><br/>
                """
                if text_quality_score >= 80:
                    text_analysis += """
                    <b>Status:</b> ✓ EXCELLENT<br/>
                    The IC markings demonstrate high-quality printing characteristics consistent with authentic OEM manufacturing:
                    <br/>• Font weight and style match OEM specifications
                    <br/>• Character spacing (kerning) is uniform and consistent
                    <br/>• Line layout and alignment are precise
                    <br/>• No visible signs of erosion, fading, or tampering
                    <br/>• Markings appear crisp and well-defined
                    <br/><br/>
                    """
                elif text_quality_score >= 70:
                    text_analysis += """
                    <b>Status:</b> ✓ GOOD<br/>
                    The IC markings show good quality with minor variations:
                    <br/>• Overall font characteristics are consistent with OEM standards
                    <br/>• Minor inconsistencies in spacing or alignment may be present but within acceptable limits
                    <br/>• No significant signs of tampering or remarking
                    <br/><br/>
                    """
                elif text_quality_score >= 50:
                    text_analysis += """
                    <b>Status:</b> ⚠ MODERATE<br/>
                    The IC markings show moderate quality with some concerns:
                    <br/>• Some inconsistencies in font weight, spacing, or alignment detected
                    <br/>• Minor erosion or wear may be visible
                    <br/>• Markings may appear slightly faded or irregular
                    <br/>• Further inspection recommended to rule out remarking
                    <br/><br/>
                    """
                else:
                    text_analysis += """
                    <b>Status:</b> ✗ POOR<br/>
                    The IC markings show significant quality issues that raise concerns:
                    <br/>• Inconsistent font weight, spacing, or alignment
                    <br/>• Visible erosion, fading, or irregular printing
                    <br/>• Possible signs of remarking or surface tampering
                    <br/>• Markings do not match OEM quality standards
                    <br/>• This is a strong indicator of potential counterfeiting
                    <br/><br/>
                    """
                story.append(Paragraph(text_analysis, styles['Normal']))
                story.append(Spacer(1, 0.15*inch))
            
            # Pin Count and Spacing Analysis
            story.append(Paragraph("<b>2. Pin Configuration Analysis</b>", styles['Heading3']))
            pin_analysis = ""
            
            pin_verified = visual.get('pin_count_verified', False)
            if pin_verified:
                pin_analysis += f"""
                <b>Pin Count:</b> ✓ VERIFIED ({result.pin_count} pins)<br/>
                The actual pin count matches the datasheet specification. All pins are present and accounted for.
                <br/><br/>
                """
            else:
                pin_analysis += f"""
                <b>Pin Count:</b> ✗ MISMATCH<br/>
                Pin count discrepancy detected. Expected {result.pin_count} pins according to datasheet, but actual count differs.
                This is a significant red flag indicating potential counterfeiting or incorrect part identification.
                <br/><br/>
                """
            
            # Pin Pitch/Spacing
            if visual.get('pin_pitch_verified') is not None:
                pitch_verified = visual.get('pin_pitch_verified', False)
                if pitch_verified:
                    pin_analysis += """
                    <b>Pin Pitch/Spacing:</b> ✓ VERIFIED<br/>
                    Pin pitch and row-to-row spacing match datasheet specifications. Pins are properly aligned with no warping,
                    misalignment, or irregular spacing detected. The pin configuration is consistent with authentic OEM manufacturing.
                    <br/><br/>
                    """
                else:
                    pin_analysis += """
                    <b>Pin Pitch/Spacing:</b> ⚠ REVIEW NEEDED<br/>
                    Pin pitch or spacing shows discrepancies from datasheet specifications. Possible issues include:
                    <br/>• Irregular spacing between pins
                    <br/>• Misalignment or warping of pin rows
                    <br/>• Inconsistent pin-to-pin distances
                    <br/>• Deviation from standard pitch values (e.g., 1.27mm, 2.54mm)
                    <br/>Further inspection recommended to determine if this indicates counterfeiting.
                    <br/><br/>
                    """
            else:
                pin_analysis += """
                <b>Pin Pitch/Spacing:</b> Analysis not available<br/>
                Pin spacing analysis could not be performed. This may be due to image quality or angle limitations.
                <br/><br/>
                """
            
            story.append(Paragraph(pin_analysis, styles['Normal']))
            story.append(Spacer(1, 0.15*inch))
            
            # Package Type and Outline
            story.append(Paragraph("<b>3. Package Type and Outline Verification</b>", styles['Heading3']))
            package_verified = visual.get('package_type_verified', False)
            package_analysis = ""
            if package_verified:
                package_analysis += f"""
                <b>Package Type:</b> ✓ VERIFIED ({result.package_type})<br/>
                The package type matches the datasheet specification. Physical characteristics verified:
                <br/>• Package outline and dimensions are consistent
                <br/>• Corner style (chamfered, rounded, or square) matches specification
                <br/>• Overall package geometry aligns with OEM design
                <br/><br/>
                """
            else:
                package_analysis += f"""
                <b>Package Type:</b> ✗ MISMATCH<br/>
                Package type discrepancy detected. Expected {result.package_type} but physical characteristics differ from datasheet.
                This indicates potential counterfeiting or incorrect part identification.
                <br/><br/>
                """
            
            # Pin-1 Indicator
            if visual.get('pin1_indicator_verified') is not None:
                pin1_verified = visual.get('pin1_indicator_verified', False)
                if pin1_verified:
                    package_analysis += """
                    <b>Pin-1 Indicator:</b> ✓ VERIFIED<br/>
                    The pin-1 indicator (dot, notch, or bevel) location and orientation match the datasheet diagram.
                    The indicator is correctly positioned relative to the package orientation.
                    <br/><br/>
                    """
                else:
                    package_analysis += """
                    <b>Pin-1 Indicator:</b> ⚠ REVIEW NEEDED<br/>
                    Pin-1 indicator location or orientation may not match datasheet specifications. This could indicate
                    incorrect package orientation or potential counterfeiting.
                    <br/><br/>
                    """
            
            story.append(Paragraph(package_analysis, styles['Normal']))
            story.append(Spacer(1, 0.15*inch))
            
            # Surface Texture Analysis
            story.append(Paragraph("<b>4. Surface Texture and Finish Analysis</b>", styles['Heading3']))
            surface_analysis = ""
            
            if visual.get('surface_texture_assessment'):
                surface_assessment = visual.get('surface_texture_assessment', '')
                if 'uniform' in surface_assessment.lower() or 'consistent' in surface_assessment.lower():
                    surface_analysis += """
                    <b>Surface Texture:</b> ✓ UNIFORM AND CONSISTENT<br/>
                    The IC surface shows uniform texture and finish consistent with authentic OEM manufacturing:
                    <br/>• No signs of sanding, grinding, or surface tampering
                    <br/>• Finish is consistent across the entire package surface
                    <br/>• No visible irregularities or texture variations
                    <br/>• Surface appears smooth and professionally finished
                    <br/><br/>
                    """
                elif 'irregular' in surface_assessment.lower() or 'inconsistent' in surface_assessment.lower():
                    surface_analysis += """
                    <b>Surface Texture:</b> ✗ IRREGULAR OR INCONSISTENT<br/>
                    Surface texture irregularities detected, indicating potential tampering:
                    <br/>• Possible signs of sanding or surface grinding
                    <br/>• Inconsistent finish or texture variations across the package
                    <br/>• Visible marks or irregularities suggesting remarking
                    <br/>• Surface may appear rough or tampered with
                    <br/>This is a strong indicator of counterfeiting or remarking.
                    <br/><br/>
                    """
                else:
                    surface_analysis += f"""
                    <b>Surface Texture:</b> {surface_assessment}<br/>
                    Surface texture assessment completed. Review recommended for detailed analysis.
                    <br/><br/>
                    """
            else:
                surface_analysis += """
                <b>Surface Texture:</b> Analysis not available<br/>
                Surface texture analysis could not be performed. This may be due to image quality or lighting conditions.
                <br/><br/>
                """
            
            story.append(Paragraph(surface_analysis, styles['Normal']))
            story.append(Spacer(1, 0.15*inch))
            
            # Markings Analysis
            story.append(Paragraph("<b>5. Markings and Labeling Analysis</b>", styles['Heading3']))
            markings_analysis = ""
            
            if visual.get('markings_verified') is not None:
                markings_verified = visual.get('markings_verified', False)
                if markings_verified:
                    markings_analysis += """
                    <b>Markings:</b> ✓ VERIFIED<br/>
                    IC markings are consistent with OEM specifications:
                    <br/>• Part number matches expected format and style
                    <br/>• Manufacturer logo/name is correctly placed and styled
                    <br/>• Date codes and lot codes (if present) follow expected format
                    <br/>• Marking placement relative to pin-1/notch is correct
                    <br/>• Overall marking layout matches datasheet specifications
                    <br/><br/>
                    """
                else:
                    markings_analysis += """
                    <b>Markings:</b> ⚠ REVIEW NEEDED<br/>
                    Marking inconsistencies detected:
                    <br/>• Part number format or style may differ from expected
                    <br/>• Manufacturer logo placement or style may be incorrect
                    <br/>• Date/lot code format may not match OEM standards
                    <br/>• Marking placement relative to package features may be off
                    <br/>Further inspection recommended.
                    <br/><br/>
                    """
            else:
                markings_analysis += """
                <b>Markings:</b> Analysis completed<br/>
                Markings have been reviewed. Part number, manufacturer, and other identifiers have been verified.
                <br/><br/>
                """
            
            story.append(Paragraph(markings_analysis, styles['Normal']))
            story.append(Spacer(1, 0.15*inch))
            
            # QFN/BGA Specific Analysis
            if result.package_type and ('QFN' in result.package_type.upper() or 'BGA' in result.package_type.upper()):
                story.append(Paragraph("<b>6. QFN/BGA Specific Analysis</b>", styles['Heading3']))
                qfn_analysis = ""
                
                if visual.get('pad_grid_verified') is not None:
                    pad_verified = visual.get('pad_grid_verified', False)
                    if pad_verified:
                        qfn_analysis += """
                        <b>Pad/Ball Grid:</b> ✓ VERIFIED<br/>
                        Pad (QFN) or ball (BGA) grid dimensions and configuration match datasheet specifications.
                        Grid layout, spacing, and alignment are correct.
                        <br/><br/>
                        """
                    else:
                        qfn_analysis += """
                        <b>Pad/Ball Grid:</b> ⚠ REVIEW NEEDED<br/>
                        Pad or ball grid shows discrepancies. Grid dimensions, spacing, or alignment may not match
                        datasheet specifications. This could indicate counterfeiting.
                        <br/><br/>
                        """
                
                if visual.get('exposed_pad_verified') is not None:
                    epad_verified = visual.get('exposed_pad_verified', False)
                    if epad_verified:
                        qfn_analysis += """
                        <b>Exposed Pad:</b> ✓ VERIFIED<br/>
                        Exposed pad (thermal pad) presence, size, and alignment match datasheet specifications.
                        <br/><br/>
                        """
                    else:
                        qfn_analysis += """
                        <b>Exposed Pad:</b> ⚠ REVIEW NEEDED<br/>
                        Exposed pad characteristics may not match datasheet. Size, position, or presence may differ.
                        <br/><br/>
                        """
                
                if qfn_analysis:
                    story.append(Paragraph(qfn_analysis, styles['Normal']))
                    story.append(Spacer(1, 0.15*inch))
            
            # Overall Assessment
            story.append(Paragraph("<b>7. Overall Visual Assessment</b>", styles['Heading3']))
            overall_assessment = visual.get('overall_assessment', 'unknown')
            assessment_text = ""
            
            if overall_assessment.lower() == 'authentic':
                assessment_text = """
                <b>Assessment:</b> ✓ AUTHENTIC<br/>
                Based on comprehensive visual analysis, the IC appears to be authentic. All major checks passed:
                <br/>• Physical characteristics match datasheet specifications
                <br/>• No significant anomalies or red flags detected
                <br/>• Markings, dimensions, and package features are consistent with OEM standards
                <br/><br/>
                """
            elif overall_assessment.lower() == 'suspicious':
                assessment_text = """
                <b>Assessment:</b> ⚠ SUSPICIOUS<br/>
                The IC shows some concerning characteristics that warrant further investigation:
                <br/>• Some inconsistencies detected in markings, dimensions, or physical features
                <br/>• Minor anomalies may be present
                <br/>• Additional verification recommended before use
                <br/><br/>
                """
            elif overall_assessment.lower() == 'counterfeit':
                assessment_text = """
                <b>Assessment:</b> ✗ COUNTERFEIT<br/>
                The IC shows clear signs of counterfeiting:
                <br/>• Significant discrepancies from datasheet specifications
                <br/>• Multiple anomalies and red flags detected
                <br/>• Physical characteristics do not match OEM standards
                <br/>• Do not use this component in production
                <br/><br/>
                """
            else:
                assessment_text = f"""
                <b>Assessment:</b> {overall_assessment.upper()}<br/>
                Visual assessment completed. Review detailed analysis above for specific findings.
                <br/><br/>
                """
            
            story.append(Paragraph(assessment_text, styles['Normal']))
            story.append(Spacer(1, 0.2*inch))
        
        # Analysis Results Summary
        story.append(PageBreak())
        story.append(Paragraph("ANALYSIS RESULTS SUMMARY", styles['Heading2']))
        if result.reasoning:
            story.append(Paragraph(f"<b>Final Reasoning:</b> {result.reasoning}", styles['Normal']))
        story.append(Spacer(1, 0.15*inch))
        
        # Anomalies with Images and Reasoning
        if annotated_images and len(annotated_images) > 0:
            story.append(PageBreak())
            story.append(Paragraph(f"DETECTED ANOMALIES ({len(result.anomalies)})", styles['Heading2']))
            
            for i, (img_path, anom_type, description) in enumerate(annotated_images, 1):
                if anom_type == "No Anomalies":
                    # Skip if no anomalies
                    story.append(Paragraph("<b>No anomalies detected. IC appears authentic.</b>", styles['Normal']))
                    if Path(img_path).exists():
                        clean_img = RLImage(img_path, width=5*inch, height=4.5*inch, kind='proportional')
                        story.append(clean_img)
                    break
                
                # Get corresponding anomaly details
                anomaly = result.anomalies[i-1] if i <= len(result.anomalies) else {}
                
                story.append(Paragraph(f"<b>Anomaly #{i}: {anom_type}</b>", styles['Heading3']))
                
                # Anomaly details table
                severity = anomaly.get('severity', 'unknown').upper()
                severity_color = colors.red if severity == 'HIGH' else colors.orange if severity == 'MEDIUM' else colors.yellow
                
                anom_data = [
                    ['Type', anom_type],
                    ['Severity', severity],
                    ['Confidence', f"{anomaly.get('confidence', 0)*100:.0f}%"]
                ]
                
                anom_table = Table(anom_data, colWidths=[1.5*inch, 5*inch])
                anom_table.setStyle(TableStyle([
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                    ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e8e8e8')),
                    ('BACKGROUND', (1, 1), (1, 1), severity_color),
                    ('TEXTCOLOR', (1, 1), (1, 1), colors.white),
                    ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
                    ('PADDING', (0, 0), (-1, -1), 8),
                ]))
                story.append(anom_table)
                story.append(Spacer(1, 0.1*inch))
                
                # Description/Reasoning
                story.append(Paragraph("<b>Analysis:</b>", styles['Normal']))
                story.append(Paragraph(description, styles['Normal']))
                story.append(Spacer(1, 0.15*inch))
                
                # Annotated Image (ensure it fits - max 5.5 inches width)
                if Path(img_path).exists():
                    anom_img = RLImage(img_path, width=5.5*inch, height=5.0*inch, kind='proportional')
                    story.append(anom_img)
                
                if i < len(annotated_images):
                    story.append(PageBreak())
        
        # Build PDF with error handling for Flowable too large errors
        try:
            doc.build(story)
            print(f"  ✓ Report generated: {report_filename}")
        except Exception as e:
            error_msg = str(e)
            print(f"  ✗ PDF generation error: {error_msg}")
            import traceback
            traceback.print_exc()
            
            # If it's a Flowable too large error, try to rebuild with smaller images
            if 'too large' in error_msg.lower() or 'flowable' in error_msg.lower():
                print(f"  ⚠ Retrying with reduced image sizes...")
                # Create a new story with reduced image sizes
                new_story = []
                for element in story:
                    if isinstance(element, RLImage):
                        # Create new image with reduced size
                        try:
                            # Reduce by 25% to ensure it fits
                            new_width = element._width * 0.75 if hasattr(element, '_width') and element._width else 4*inch
                            new_height = element._height * 0.75 if hasattr(element, '_height') and element._height else 6*inch
                            # Ensure max dimensions
                            new_width = min(new_width, 5*inch)
                            new_height = min(new_height, 7*inch)
                            
                            # Get the image path from the element
                            img_path = element._filename if hasattr(element, '_filename') else None
                            if img_path and Path(img_path).exists():
                                new_img = RLImage(img_path, width=new_width, height=new_height, kind='proportional')
                                new_story.append(new_img)
                            else:
                                new_story.append(element)  # Keep original if we can't resize
                        except Exception as img_err:
                            print(f"  ⚠ Failed to resize image: {img_err}")
                            new_story.append(element)  # Keep original on error
                    else:
                        new_story.append(element)  # Keep non-image elements
                
                try:
                    # Create new document and build with reduced images
                    new_doc = SimpleDocTemplate(str(report_path), pagesize=letter)
                    new_doc.build(new_story)
                    print(f"  ✓ Report generated after retry: {report_filename}")
                except Exception as e2:
                    print(f"  ✗ PDF generation failed after retry: {e2}")
                    # Still return a path so the system doesn't break
                    # Create a minimal error report text file
                    error_report_path = self.output_dir / f"error_report_{Path(result.ic_image_path).stem}_{timestamp_str}.txt"
                    with open(error_report_path, 'w') as f:
                        f.write(f"PDF Generation Error\n")
                        f.write(f"==================\n\n")
                        f.write(f"Error: {error_msg}\n\n")
                        f.write(f"Detection completed successfully, but PDF report generation failed.\n\n")
                        f.write(f"IC Information:\n")
                        f.write(f"  Part Number: {result.part_number}\n")
                        f.write(f"  Manufacturer: {result.manufacturer}\n")
                        f.write(f"  Package Type: {result.package_type}\n")
                        f.write(f"  Pin Count: {result.pin_count}\n\n")
                        f.write(f"Verdict: {result.verdict}\n")
                        f.write(f"Score: {result.authenticity_score}/100\n\n")
                        f.write(f"Anomalies: {len(result.anomalies)}\n")
                    print(f"  ⚠ Created error report: {error_report_path}")
                    return str(error_report_path)
            else:
                # For other errors, still try to create error report
                error_report_path = self.output_dir / f"error_report_{Path(result.ic_image_path).stem}_{timestamp_str}.txt"
                with open(error_report_path, 'w') as f:
                    f.write(f"PDF Generation Error\n")
                    f.write(f"==================\n\n")
                    f.write(f"Error: {error_msg}\n\n")
                    f.write(f"Detection completed successfully, but PDF report generation failed.\n\n")
                    f.write(f"IC Information:\n")
                    f.write(f"  Part Number: {result.part_number}\n")
                    f.write(f"  Manufacturer: {result.manufacturer}\n")
                    f.write(f"  Package Type: {result.package_type}\n")
                    f.write(f"  Pin Count: {result.pin_count}\n\n")
                    f.write(f"Verdict: {result.verdict}\n")
                    f.write(f"Score: {result.authenticity_score}/100\n\n")
                    f.write(f"Anomalies: {len(result.anomalies)}\n")
                print(f"  ⚠ Created error report: {error_report_path}")
                return str(error_report_path)
        
        return str(report_path)
    
    def _create_annotated_images(self, result: DetectionResult) -> List[Tuple[str, str, str]]:
        """Create separate annotated images for each anomaly
        
        Returns:
            List of (image_path, anomaly_type, description) tuples
        """
        annotated_images = []
        
        try:
            # Try to load a better font
            try:
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 28)
                small_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
            except:
                font = ImageFont.load_default()
                small_font = font
            
            if result.anomalies and len(result.anomalies) > 0:
                # Create ONE image per anomaly
                for i, anomaly in enumerate(result.anomalies, 1):
                    bbox = anomaly.get('bbox')
                    if not bbox or len(bbox) != 4:
                        continue
                    
                    # Load fresh image for each anomaly
                    img = Image.open(result.ic_image_path)
                    draw = ImageDraw.Draw(img)
                    
                    # Convert normalized coords to pixel coords
                    x1, y1, x2, y2 = bbox
                    x1 = int(x1 * img.width)
                    y1 = int(y1 * img.height)
                    x2 = int(x2 * img.width)
                    y2 = int(y2 * img.height)
                    
                    # Color based on severity
                    severity = anomaly.get('severity', 'low')
                    color = 'red' if severity == 'high' else 'orange' if severity == 'medium' else 'yellow'
                    
                    # Draw rectangle (thicker)
                    for offset in range(6):
                        draw.rectangle([x1-offset, y1-offset, x2+offset, y2+offset], outline=color, width=1)
                    
                    # Draw label with background
                    anomaly_type = anomaly.get('type', 'anomaly').replace('_', ' ').title()
                    label = f"Anomaly #{i}: {anomaly_type}"
                    
                    # Get text bbox for background
                    text_bbox = draw.textbbox((x1, y1 - 40), label, font=small_font)
                    draw.rectangle(text_bbox, fill=color)
                    draw.text((x1, y1 - 40), label, fill='white', font=small_font)
                    
                    # Save this anomaly's image
                    output_path = self.output_dir / f"anomaly_{i}_{Path(result.ic_image_path).stem}.png"
                    img.save(output_path)
                    
                    annotated_images.append((
                        str(output_path),
                        anomaly_type,
                        anomaly.get('description', 'No description')
                    ))
                
                print(f"  ✓ Created {len(annotated_images)} annotated images (one per anomaly)")
            else:
                # No anomalies - create one image with checkmark
                img = Image.open(result.ic_image_path)
                draw = ImageDraw.Draw(img)
                draw.text((20, 20), "✓ NO ANOMALIES DETECTED", fill='green', font=font)
                
                output_path = self.output_dir / f"annotated_{Path(result.ic_image_path).name}"
                img.save(output_path)
                
                annotated_images.append((
                    str(output_path),
                    "No Anomalies",
                    "All checks passed"
                ))
                
                print(f"  ✓ No anomalies detected - clean image saved")
            
            return annotated_images
            
        except Exception as e:
            print(f"  ⚠️  Failed to create annotated images: {e}")
            import traceback
            traceback.print_exc()
            return []


def main():
    """CLI interface"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Counterfeit IC Detection System",
        epilog="Example: python counterfeit_detector.py ic_image.png"
    )
    parser.add_argument("ic_image", help="Path to IC image to analyze")
    parser.add_argument("--output-dir", "-o", help="Output directory for results", 
                       default="./detection_results")
    
    args = parser.parse_args()
    
    # Run detection
    detector = CounterfeitDetector(output_dir=args.output_dir)
    result = detector.detect(args.ic_image)
    
    # Save result as JSON
    result_json_path = Path(args.output_dir) / f"result_{Path(args.ic_image).stem}.json"
    with open(result_json_path, 'w') as f:
        json.dump(asdict(result), f, indent=2)
    
    print(f"\n✅ Result saved: {result_json_path}")


if __name__ == '__main__':
    main()

