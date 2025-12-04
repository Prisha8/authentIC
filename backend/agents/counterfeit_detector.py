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
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, PageBreak, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
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
    ic_image_path: str
    part_number: str = "UNKNOWN"
    manufacturer: str = "UNKNOWN"
    package_type: str = "UNKNOWN"
    pin_count: int = 0
    
    # Datasheet info
    datasheet_path: Optional[str] = None
    mechanical_diagram_path: Optional[str] = None
    parsed_specs: Optional[Dict] = None
    
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
                result.pin_count
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
            dimension_analysis=dimension_dict  # Pass dimension analysis to Gemini
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
    
    def _identify_ic(self, image_path: Path) -> Dict:
        """Step 1: Identify IC using Gemini VLM"""
        try:
            ic_info = identify_ic(self.identifier_model, str(image_path))
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
                         package_type: str, pin_count: int) -> Tuple[Optional[str], Optional[Dict]]:
        """Step 3: Parse datasheet and extract mechanical diagram + specs"""
        try:
            parser = DatasheetParser(pdf_path, output_dir=str(self.output_dir / "diagrams"))
            info = parser.parse(part_number, package_type, pin_count)
            
            # Save parsed info as JSON
            json_path = parser.save_summary(info)
            
            # Select BEST mechanical diagram by reading page content
            # Priority: pages with "outline" + dimensions table > mechanical data > others
            # Avoid revision history pages
            best_diagram = None
            if info.mechanical_diagrams:
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
                        
                        # Penalize revision history or index pages
                        if 'revision history' in text_lower or 'document revision' in text_lower:
                            score -= 200
                        
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
                    print(f"  → Selected best diagram: page {best_page_num} (score: {best_score})")
                    
                    # Re-parse dimensions from the BEST page only
                    print(f"  → Re-parsing dimensions from page {best_page_num}...")
                    parser._parse_package_dimensions(info, selected_page=best_page_num)
                    
                    # Save updated summary
                    json_path = parser.save_summary(info)
            
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
    
    def _estimate_package_dimensions(self, package_type: str, pin_count: int) -> Tuple[float, float]:
        """
        Estimate typical package dimensions based on package type and pin count
        
        Returns:
            (length_mm, width_mm) - typical dimensions for the package
        """
        package_upper = package_type.upper()
        
        # DIP packages (elongated, ~2.5:1 ratio)
        if 'DIP' in package_upper or 'PDIP' in package_upper:
            if pin_count <= 8:
                return (9.8, 6.4)  # DIP-8
            elif pin_count <= 14:
                return (19.2, 6.4)  # DIP-14
            elif pin_count <= 16:
                return (19.6, 7.6)  # DIP-16
            else:
                return (pin_count * 1.2, 7.6)  # Estimate
        
        # SOIC packages (elongated, ~2:1 ratio)
        elif 'SOIC' in package_upper or 'SO' in package_upper:
            if pin_count <= 8:
                return (5.0, 4.0)  # SOIC-8
            elif pin_count <= 14:
                return (8.7, 3.9)  # SOIC-14
            elif pin_count <= 16:
                return (10.0, 3.9)  # SOIC-16
            elif pin_count <= 28:
                return (18.0, 7.5)  # SOIC-28
            else:
                return (pin_count * 0.6, 7.5)
        
        # QFP/LQFP packages (square, 1:1 ratio)
        elif 'QFP' in package_upper or 'LQFP' in package_upper or 'TQFP' in package_upper:
            if pin_count <= 32:
                return (7.0, 7.0)  # LQFP-32
            elif pin_count <= 48:
                return (7.0, 7.0)  # LQFP-48
            elif pin_count <= 64:
                return (10.0, 10.0)  # LQFP-64
            elif pin_count <= 100:
                return (14.0, 14.0)  # LQFP-100
            else:
                return (20.0, 20.0)  # LQFP-144+
        
        # QFN packages (square, 1:1 ratio)
        elif 'QFN' in package_upper or 'MLF' in package_upper:
            if pin_count <= 16:
                return (3.0, 3.0)  # QFN-16
            elif pin_count <= 32:
                return (5.0, 5.0)  # QFN-32
            elif pin_count <= 48:
                return (7.0, 7.0)  # QFN-48
            else:
                return (9.0, 9.0)  # QFN-64+
        
        # BGA packages (square, 1:1 ratio)
        elif 'BGA' in package_upper:
            if pin_count <= 64:
                return (8.0, 8.0)
            elif pin_count <= 100:
                return (10.0, 10.0)
            else:
                return (15.0, 15.0)
        
        # Default: assume square package
        else:
            return (10.0, 10.0)
    
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
{
  "body_length_mm": <number or null>,
  "body_width_mm": <number or null>,
  "height_mm": <number or null>,
  "pin_count": <number or null>,
  "pin_pitch_mm": <number or null>,
  "package_type": "<string or null>"
}
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
            # Get expected dimensions from parsed specs or use intelligent defaults
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
            
            # Priority 3: Fallback to package-type-based heuristics
            if not expected_length or not expected_width:
                print(f"  ⚠️  No extracted dimensions available, using package type heuristics...")
                expected_length, expected_width = self._estimate_package_dimensions(result.package_type, result.pin_count)
                print(f"     Estimated: {expected_length} × {expected_width} mm (based on {result.package_type})")
                dimension_source = "heuristics"
            
            dim_result = estimate_dimensions(
                str(image_path),
                expected_length,
                expected_width
            )
            
            # Generate visualization
            from tools.dimension_estimator import visualize_dimensions
            viz_path = str(self.output_dir / f"dimension_analysis_{image_path.stem}.png")
            visualize_dimensions(str(image_path), dim_result)
            
            # Move the generated visualization
            import shutil
            default_viz = str(image_path).replace('.png', '_dimension_analysis.png')
            if Path(default_viz).exists():
                shutil.move(default_viz, viz_path)
            
            # Convert DimensionResult to dict
            dim_dict = {
                'measured_aspect_ratio': dim_result.measured_aspect_ratio,
                'expected_aspect_ratio': dim_result.expected_aspect_ratio,
                'confidence_score': dim_result.dimension_score,
                'bboxes': dim_result.bboxes,
                'verdict': dim_result.verdict,
                'dimension_source': dimension_source,  # Track where dimensions came from
                'expected_length_mm': expected_length,
                'expected_width_mm': expected_width
            }
            
            print(f"  ✓ Dimension analysis complete (source: {dimension_source})")
            print(f"    Expected: {expected_length} × {expected_width} mm (AR: {dim_dict['expected_aspect_ratio']:.2f})")
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
                                dimension_analysis: Optional[Dict] = None) -> Dict:
        """Step 5: Gemini visual comparison and anomaly detection"""
        
        try:
            # Load IC image
            ic_image = Image.open(ic_image_path)
            
            # Build prompt with parsed specs and dimension analysis
            prompt = self._build_analysis_prompt(result, mechanical_diagram is not None, parsed_specs, dimension_analysis)
            
            # If we have mechanical diagram, include it
            if mechanical_diagram:
                diagram_image = Image.open(mechanical_diagram)
                
                # Build content list
                content = [prompt, ic_image]
                
                # Add parsed specs as JSON
                if parsed_specs:
                    content.append("\n\nPARSED DATASHEET SPECIFICATIONS (JSON):")
                    content.append(json.dumps(parsed_specs, indent=2))
                
                content.append("\n\nDATASHEET MECHANICAL DIAGRAM:")
                content.append(diagram_image)
                
                print("  → Comparing IC image with datasheet (diagram + specs)...")
                response = self.analysis_model.generate_content(content)
            else:
                print("  → Analyzing IC image (no datasheet available)...")
                response = self.analysis_model.generate_content([prompt, ic_image])
            
            # Parse response
            analysis = self._parse_gemini_response(response.text)
            
            print(f"  ✓ Visual analysis complete")
            print(f"    Anomalies detected: {len(analysis.get('anomalies', []))}")
            
            return analysis
            
        except Exception as e:
            print(f"  ✗ Visual analysis failed: {e}")
            return {'anomalies': [], 'observations': str(e)}
    
    def _build_analysis_prompt(self, result: DetectionResult, has_diagram: bool, parsed_specs: Optional[Dict] = None, dimension_analysis: Optional[Dict] = None) -> str:
        """Build prompt for Gemini visual analysis"""
        
        base_prompt = f"""You are an expert in counterfeit IC detection. Analyze this IC image for authenticity.

**IC Information:**
- Part Number: {result.part_number}
- Manufacturer: {result.manufacturer}
- Package: {result.package_type} ({result.pin_count}-pin)
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
            base_prompt += f"""
**CV Dimension Analysis Results:**
- Expected Aspect Ratio: {dimension_analysis.get('expected_aspect_ratio', '?'):.2f} (from {dimension_analysis.get('dimension_source', 'unknown')})
- Measured Aspect Ratio: {dimension_analysis.get('measured_aspect_ratio', '?'):.2f}
- Dimension Match Score: {dimension_analysis.get('confidence_score', '?'):.1f}/100
- Verdict: {dimension_analysis.get('verdict', 'UNKNOWN')}
- Expected Dimensions: {dimension_analysis.get('expected_length_mm', '?')} × {dimension_analysis.get('expected_width_mm', '?')} mm

**Note:** Use this CV analysis to inform your assessment. If the dimension score is low, investigate why (wrong package type identification, orientation, or actual dimensional mismatch).
"""

        base_prompt += """
**Your Task:**
1. Examine the IC image carefully for signs of counterfeiting
2. Check for: text quality, surface texture, pin alignment, package dimensions, markings
"""

        if has_diagram:
            base_prompt += """3. Compare the IC image with the datasheet mechanical diagram AND parsed specifications
4. Verify dimensional accuracy, pin count, package type match the datasheet
5. Check if pin spacing matches the specified pin pitch
6. Cross-validate with the CV dimension analysis results above
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
        """Step 6: Calculate final verdict based on all analyses"""
        
        scores = []
        weights = []
        
        # Dimension analysis score
        if result.dimension_analysis:
            dim_score = result.dimension_analysis.get('confidence_score', 50)
            scores.append(dim_score)
            weights.append(0.3)
        
        # Visual analysis score
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
            weights.append(0.5)
        
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
            result.verdict = "SUSPICIOUS - REQUIRES INSPECTION"
        else:
            result.verdict = "LIKELY COUNTERFEIT"
        
        # Build reasoning
        reasoning_parts = []
        
        if result.dimension_analysis:
            reasoning_parts.append(
                f"Dimensional analysis: {result.dimension_analysis.get('confidence_score', 0):.1f}/100"
            )
        
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
    
    def _generate_report(self, result: DetectionResult) -> str:
        """Step 7: Generate PDF report with bboxes and analysis"""
        
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_filename = f"detection_report_{Path(result.ic_image_path).stem}_{timestamp_str}.pdf"
        report_path = self.output_dir / report_filename
        
        # Create annotated images (one per anomaly)
        annotated_images = self._create_annotated_images(result)
        
        # Build PDF
        doc = SimpleDocTemplate(str(report_path), pagesize=letter)
        styles = getSampleStyleSheet()
        story = []
        
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#1a1a1a'),
            spaceAfter=30,
            alignment=TA_CENTER
        )
        story.append(Paragraph("COUNTERFEIT IC DETECTION REPORT", title_style))
        story.append(Spacer(1, 0.3*inch))
        
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
        story.append(Spacer(1, 0.3*inch))
        
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
        story.append(Spacer(1, 0.2*inch))
        
        # Dimension Analysis Visualization (if available)
        if result.dimension_visualization and Path(result.dimension_visualization).exists():
            story.append(PageBreak())
            story.append(Paragraph("DIMENSION ANALYSIS", styles['Heading2']))
            dim_viz = RLImage(result.dimension_visualization, width=7*inch, height=5*inch, kind='proportional')
            story.append(dim_viz)
            story.append(Spacer(1, 0.2*inch))
        
        # Mechanical Diagram (if available)
        if result.mechanical_diagram_path and Path(result.mechanical_diagram_path).exists():
            story.append(PageBreak())
            story.append(Paragraph("DATASHEET MECHANICAL DIAGRAM", styles['Heading2']))
            diagram_img = RLImage(result.mechanical_diagram_path, width=6.5*inch, height=6.5*inch, kind='proportional')
            story.append(diagram_img)
            story.append(Spacer(1, 0.2*inch))
        
        # Analysis Results
        story.append(Paragraph("ANALYSIS RESULTS", styles['Heading2']))
        story.append(Paragraph(f"<b>Reasoning:</b> {result.reasoning}", styles['Normal']))
        story.append(Spacer(1, 0.1*inch))
        
        # Anomalies with Images and Reasoning
        if annotated_images and len(annotated_images) > 0:
            story.append(PageBreak())
            story.append(Paragraph(f"DETECTED ANOMALIES ({len(result.anomalies)})", styles['Heading2']))
            
            for i, (img_path, anom_type, description) in enumerate(annotated_images, 1):
                if anom_type == "No Anomalies":
                    # Skip if no anomalies
                    story.append(Paragraph("<b>No anomalies detected. IC appears authentic.</b>", styles['Normal']))
                    if Path(img_path).exists():
                        clean_img = RLImage(img_path, width=5*inch, height=5*inch, kind='proportional')
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
                
                # Annotated Image
                if Path(img_path).exists():
                    anom_img = RLImage(img_path, width=5.5*inch, height=5.5*inch, kind='proportional')
                    story.append(anom_img)
                
                if i < len(annotated_images):
                    story.append(PageBreak())
        
        # Build PDF
        doc.build(story)
        print(f"  ✓ Report generated: {report_filename}")
        
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

