#!/usr/bin/env python3
"""
History Manager for Processing History System
Saves comprehensive processing data for RAG queries and history display
"""

from pathlib import Path
import json
import shutil
from datetime import datetime
from typing import Dict, Optional, List
from PIL import Image
import traceback

# Import DetectionResult from counterfeit_detector
import sys
from pathlib import Path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))
from agents.counterfeit_detector import DetectionResult


class HistoryManager:
    """Manages saving and loading of processing history"""
    
    def __init__(self, base_dir: str = "data/api_results"):
        """
        Initialize HistoryManager
        
        Args:
            base_dir: Base directory for api_results (relative to project root)
        """
        # Resolve path relative to project root (counterfeit_IC/)
        # __file__ is at backend/utils/history_manager.py
        # Go up: backend/utils -> backend -> counterfeit_IC (project root)
        backend_dir = Path(__file__).parent.parent  # backend/
        project_root = backend_dir.parent  # counterfeit_IC/
        self.base_dir = project_root / base_dir
        self.history_dir = self.base_dir / "history"
        self.history_dir.mkdir(parents=True, exist_ok=True)
        print(f"[History] Initialized with base_dir: {self.base_dir.resolve()}")
        print(f"[History] History directory: {self.history_dir.resolve()}")
    
    def save_processing(self, result: DetectionResult, session_id: str, 
                       progress_data: Optional[List[Dict]] = None) -> Dict:
        """
        Save comprehensive processing data to history
        
        Args:
            result: DetectionResult object with all processing data
            session_id: Unique session identifier
            progress_data: Optional list of progress updates
            
        Returns:
            Dict with saved paths and metadata
        """
        try:
            # Create session directory
            session_dir = self.history_dir / session_id
            session_dir.mkdir(parents=True, exist_ok=True)
            
            # Create subdirectories
            images_dir = session_dir / "images"
            reports_dir = session_dir / "reports"
            datasheets_dir = session_dir / "datasheets"
            analysis_dir = session_dir / "analysis"
            tool_outputs_dir = analysis_dir / "tool_outputs"
            
            for dir_path in [images_dir, reports_dir, datasheets_dir, analysis_dir, tool_outputs_dir]:
                dir_path.mkdir(parents=True, exist_ok=True)
            
            saved_paths = {}
            
            # 1. Save images
            if result.ic_image_path:
                primary_image_path = Path(result.ic_image_path)
                if primary_image_path.exists():
                    # Copy primary image
                    primary_dest = images_dir / "primary.png"
                    shutil.copy2(primary_image_path, primary_dest)
                    saved_paths['primary_image'] = str(primary_dest.relative_to(self.base_dir))
                    
                    # Generate thumbnail (150x150px)
                    try:
                        with Image.open(primary_image_path) as img:
                            img.thumbnail((150, 150), Image.Resampling.LANCZOS)
                            thumbnail_path = images_dir / "thumbnail.png"
                            img.save(thumbnail_path)
                            saved_paths['thumbnail'] = str(thumbnail_path.relative_to(self.base_dir))
                    except Exception as e:
                        print(f"[History] Warning: Failed to generate thumbnail: {e}")
            
            # Save additional views if available
            if result.ic_image_paths and len(result.ic_image_paths) > 1:
                views_dir = images_dir / "views"
                views_dir.mkdir(exist_ok=True)
                for idx, img_path in enumerate(result.ic_image_paths[1:], 1):
                    img_path_obj = Path(img_path)
                    if img_path_obj.exists():
                        view_dest = views_dir / f"view_{idx}.png"
                        shutil.copy2(img_path_obj, view_dest)
            
            # 2. Save report PDF
            if result.report_path:
                report_path_obj = Path(result.report_path)
                if report_path_obj.exists():
                    report_dest = reports_dir / "analysis_report.pdf"
                    shutil.copy2(report_path_obj, report_dest)
                    saved_paths['report_pdf'] = str(report_dest.relative_to(self.base_dir))
                    
                    # Extract text content from PDF for RAG
                    try:
                        report_text = self._extract_pdf_text(report_path_obj)
                        report_content_path = reports_dir / "report_content.json"
                        with open(report_content_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'extracted_text': report_text,
                                'source_pdf': str(report_dest.name),
                                'extracted_at': datetime.now().isoformat()
                            }, f, indent=2, ensure_ascii=False)
                    except Exception as e:
                        print(f"[History] Warning: Failed to extract PDF text: {e}")
            
            # 3. Save datasheet
            if result.datasheet_path:
                datasheet_path_obj = Path(result.datasheet_path)
                if datasheet_path_obj.exists():
                    datasheet_dest = datasheets_dir / "datasheet.pdf"
                    shutil.copy2(datasheet_path_obj, datasheet_dest)
                    saved_paths['datasheet'] = str(datasheet_dest.relative_to(self.base_dir))
                    
                    # Extract/parse datasheet content for RAG
                    try:
                        datasheet_text = self._extract_pdf_text(datasheet_path_obj)
                        datasheet_content_path = datasheets_dir / "datasheet_content.json"
                        with open(datasheet_content_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'extracted_text': datasheet_text,
                                'parsed_specs': result.parsed_specs or {},
                                'source_pdf': str(datasheet_dest.name),
                                'extracted_at': datetime.now().isoformat()
                            }, f, indent=2, ensure_ascii=False)
                    except Exception as e:
                        print(f"[History] Warning: Failed to extract datasheet content: {e}")
            
            # 4. Save comprehensive analysis data
            analysis_data = {
                'ic_details': {
                    'part_number': result.part_number,
                    'manufacturer': result.manufacturer,
                    'package_type': result.package_type,
                    'pin_count': result.pin_count,
                    'additional_info': result.additional_info
                },
                'oem_info': {
                    'datasheet_path': result.datasheet_path,
                    'mechanical_diagram_path': result.mechanical_diagram_path,
                    'parsed_specs': result.parsed_specs or {}
                },
                'dimension_analysis': result.dimension_analysis or {},
                'visual_comparison': result.visual_comparison or {},
                'anomalies': result.anomalies or [],
                'reasoning': getattr(result, 'reasoning', '') or ''
            }
            
            # Save individual analysis files
            with open(analysis_dir / "ic_details.json", 'w', encoding='utf-8') as f:
                json.dump(analysis_data['ic_details'], f, indent=2, ensure_ascii=False)
            
            with open(analysis_dir / "oem_info.json", 'w', encoding='utf-8') as f:
                json.dump(analysis_data['oem_info'], f, indent=2, ensure_ascii=False)
            
            with open(analysis_dir / "dimension_analysis.json", 'w', encoding='utf-8') as f:
                json.dump(analysis_data['dimension_analysis'], f, indent=2, ensure_ascii=False)
            
            with open(analysis_dir / "visual_comparison.json", 'w', encoding='utf-8') as f:
                json.dump(analysis_data['visual_comparison'], f, indent=2, ensure_ascii=False)
            
            with open(analysis_dir / "anomalies.json", 'w', encoding='utf-8') as f:
                json.dump(analysis_data['anomalies'], f, indent=2, ensure_ascii=False)
            
            with open(analysis_dir / "reasoning.json", 'w', encoding='utf-8') as f:
                json.dump({'reasoning': analysis_data['reasoning']}, f, indent=2, ensure_ascii=False)
            
            # 5. Save tool outputs (if available in progress data)
            if progress_data:
                for progress_item in progress_data:
                    step = progress_item.get('step')
                    data = progress_item.get('data') or progress_item.get('output')
                    if step and data:
                        tool_output_path = tool_outputs_dir / f"{step}.json"
                        with open(tool_output_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'step': step,
                                'timestamp': progress_item.get('timestamp', datetime.now().isoformat()),
                                'data': data
                            }, f, indent=2, ensure_ascii=False)
            
            # 6. Save progress chain
            if progress_data:
                progress_path = session_dir / "progress.json"
                with open(progress_path, 'w', encoding='utf-8') as f:
                    json.dump(progress_data, f, indent=2, ensure_ascii=False)
            
            # 7. Create RAG index (concatenated searchable content)
            rag_content = self._create_rag_index(result, analysis_data, session_dir)
            rag_index_path = session_dir / "rag_index.json"
            with open(rag_index_path, 'w', encoding='utf-8') as f:
                json.dump(rag_content, f, indent=2, ensure_ascii=False)
            
            # 8. Create metadata.json (for card display)
            metadata = self._create_metadata(result, session_id, saved_paths)
            metadata_path = session_dir / "metadata.json"
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
            
            print(f"[History] Successfully saved processing history: {session_id}")
            return {
                'session_id': session_id,
                'metadata_path': str(metadata_path),
                'saved_paths': saved_paths
            }
            
        except Exception as e:
            print(f"[History] Error saving processing history: {e}")
            traceback.print_exc()
            raise
    
    def _extract_pdf_text(self, pdf_path: Path) -> str:
        """Extract text content from PDF for RAG indexing"""
        try:
            import PyPDF2
            text_content = []
            with open(pdf_path, 'rb') as f:
                pdf_reader = PyPDF2.PdfReader(f)
                for page in pdf_reader.pages:
                    text_content.append(page.extract_text())
            return '\n\n'.join(text_content)
        except ImportError:
            print("[History] PyPDF2 not available, skipping PDF text extraction")
            return ""
        except Exception as e:
            print(f"[History] Error extracting PDF text: {e}")
            return ""
    
    def _create_rag_index(self, result: DetectionResult, analysis_data: Dict, 
                          session_dir: Path) -> Dict:
        """Create RAG index with concatenated searchable content"""
        sections = {}
        full_text_parts = []
        
        # IC Identification
        ic_text = f"IC Identification: Part Number {result.part_number}, Manufacturer {result.manufacturer}, Package Type {result.package_type}, Pin Count {result.pin_count}"
        if result.additional_info:
            ic_text += f". Additional Information: {result.additional_info}"
        sections['ic_identification'] = ic_text
        full_text_parts.append(ic_text)
        
        # Datasheet content
        datasheet_content_path = session_dir / "datasheets" / "datasheet_content.json"
        if datasheet_content_path.exists():
            try:
                with open(datasheet_content_path, 'r', encoding='utf-8') as f:
                    datasheet_data = json.load(f)
                    datasheet_text = datasheet_data.get('extracted_text', '')
                    if datasheet_text:
                        sections['datasheet_content'] = datasheet_text
                        full_text_parts.append(f"Datasheet Content:\n{datasheet_text}")
            except Exception as e:
                print(f"[History] Error reading datasheet content: {e}")
        
        # Dimension Analysis
        if analysis_data.get('dimension_analysis'):
            dim_text = json.dumps(analysis_data['dimension_analysis'], indent=2)
            sections['dimension_analysis'] = dim_text
            full_text_parts.append(f"Dimension Analysis:\n{dim_text}")
        
        # Visual Analysis
        if analysis_data.get('visual_comparison'):
            visual_text = json.dumps(analysis_data['visual_comparison'], indent=2)
            sections['visual_analysis'] = visual_text
            full_text_parts.append(f"Visual Analysis:\n{visual_text}")
        
        # Anomalies
        if analysis_data.get('anomalies'):
            anomalies_text = '\n'.join([
                f"Anomaly {i+1}: {anom.get('type', 'Unknown')} - {anom.get('description', 'No description')}"
                for i, anom in enumerate(analysis_data['anomalies'])
            ])
            sections['anomalies'] = anomalies_text
            full_text_parts.append(f"Anomalies:\n{anomalies_text}")
        
        # Reasoning
        if analysis_data.get('reasoning'):
            sections['reasoning'] = analysis_data['reasoning']
            full_text_parts.append(f"Reasoning:\n{analysis_data['reasoning']}")
        
        # Report summary
        report_content_path = session_dir / "reports" / "report_content.json"
        if report_content_path.exists():
            try:
                with open(report_content_path, 'r', encoding='utf-8') as f:
                    report_data = json.load(f)
                    report_text = report_data.get('extracted_text', '')
                    if report_text:
                        sections['report_summary'] = report_text[:2000]  # First 2000 chars
                        full_text_parts.append(f"Report Summary:\n{report_text[:2000]}")
            except Exception as e:
                print(f"[History] Error reading report content: {e}")
        
        full_text_content = '\n\n'.join(full_text_parts)
        
        # Extract keywords
        keywords = []
        if result.part_number and result.part_number != "UNKNOWN":
            keywords.append(result.part_number)
        if result.manufacturer and result.manufacturer != "UNKNOWN":
            keywords.append(result.manufacturer)
        if result.package_type and result.package_type != "UNKNOWN":
            keywords.append(result.package_type)
        keywords.extend([result.verdict, f"score_{result.authenticity_score}"])
        
        return {
            'session_id': str(session_dir.name),
            'part_number': result.part_number,
            'manufacturer': result.manufacturer,
            'full_text_content': full_text_content,
            'sections': sections,
            'keywords': keywords,
            'created_at': datetime.now().isoformat()
        }
    
    def _create_metadata(self, result: DetectionResult, session_id: str, 
                        saved_paths: Dict) -> Dict:
        """Create metadata.json for card display"""
        # Extract COO from IC info if available
        coo = "Unknown"
        date_codes = []
        lot_codes = []
        
        # Try to get from visual_comparison or dimension_analysis
        if result.visual_comparison:
            # Check if COO is mentioned in visual comparison
            visual_text = json.dumps(result.visual_comparison).lower()
            for country_code in ['ph', 'my', 'cn', 'tw', 'us', 'jp']:
                if country_code in visual_text:
                    coo = country_code.upper()
                    break
        
        # Extract from additional_info if available
        if result.additional_info:
            info_lower = result.additional_info.lower()
            # Simple extraction - can be enhanced
            if 'coo' in info_lower or 'country' in info_lower:
                # Try to extract country code
                pass
        
        return {
            'session_id': session_id,
            'processed_date': result.timestamp or datetime.now().isoformat(),
            'user_id': None,  # Future: Supabase user_id
            'machine_id': None,  # Future: local machine identifier
            'ic_info': {
                'part_number': result.part_number or "UNKNOWN",
                'manufacturer': result.manufacturer or "UNKNOWN",
                'package_type': result.package_type or "UNKNOWN",
                'pin_count': result.pin_count or 0,
                'coo': coo,
                'date_codes': date_codes,
                'lot_codes': lot_codes,
                'temperature_grade': None,
                'speed_grade': None,
                'package_variant': None
            },
            'scores': {
                'authenticity_score': result.authenticity_score or 0.0,
                'visual_match': result.visual_comparison.get('text_quality_score', 0) if result.visual_comparison else 0,
                'dimension_score': result.dimension_analysis.get('confidence_score', 0) if result.dimension_analysis else 0,
                'confidence': result.authenticity_score or 0.0,
                'text_quality_score': result.visual_comparison.get('text_quality_score', 0) if result.visual_comparison else 0
            },
            'verdict': result.verdict or "UNKNOWN",
            'file_paths': saved_paths,
            'processing_time_seconds': result.processing_time_seconds or 0.0,
            'anomalies_count': len(result.anomalies) if result.anomalies else 0,
            'additional_info': result.additional_info or ""
        }
    
    def load_history_list(self, limit: Optional[int] = None) -> List[Dict]:
        """Load list of all processing history (metadata only)"""
        history_list = []
        
        # Check new location first
        if self.history_dir.exists():
            for session_dir in sorted(self.history_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                if not session_dir.is_dir():
                    continue
                
                metadata_path = session_dir / "metadata.json"
                if metadata_path.exists():
                    try:
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                            history_list.append(metadata)
                    except Exception as e:
                        print(f"[History] Error loading metadata from {session_dir}: {e}")
                
                if limit and len(history_list) >= limit:
                    break
        
        # All history is now stored inside counterfeit_IC/data (no old locations)
        
        # Sort by processed_date (most recent first)
        history_list.sort(key=lambda x: x.get('processed_date', ''), reverse=True)
        if limit:
            history_list = history_list[:limit]
        
        return history_list
    
    def delete_history(self, session_id: str) -> bool:
        """
        Delete a history entry and all its associated files
        
        Args:
            session_id: Session ID to delete
            
        Returns:
            True if deleted successfully, False otherwise
        """
        try:
            session_dir = self.history_dir / session_id
            if not session_dir.exists():
                print(f"[History] Session directory not found: {session_id}")
                return False
            
            # Remove the entire session directory
            shutil.rmtree(session_dir)
            print(f"[History] Successfully deleted history: {session_id}")
            return True
            
        except Exception as e:
            print(f"[History] Error deleting history {session_id}: {e}")
            traceback.print_exc()
            return False
    
    def load_history_detail(self, session_id: str) -> Optional[Dict]:
        """Load full details for a specific processing"""
        session_dir = self.history_dir / session_id
        
        # All history is now stored inside counterfeit_IC/data (no old locations)
        if not session_dir.exists():
            return None
        
        try:
            # Load metadata
            metadata_path = session_dir / "metadata.json"
            if not metadata_path.exists():
                return None
            
            with open(metadata_path, 'r', encoding='utf-8') as f:
                detail = json.load(f)
            
            # Load all analysis data
            analysis_dir = session_dir / "analysis"
            if analysis_dir.exists():
                detail['analysis'] = {}
                for analysis_file in ['ic_details.json', 'oem_info.json', 'dimension_analysis.json', 
                                     'visual_comparison.json', 'anomalies.json', 'reasoning.json']:
                    analysis_path = analysis_dir / analysis_file
                    if analysis_path.exists():
                        with open(analysis_path, 'r', encoding='utf-8') as f:
                            detail['analysis'][analysis_file.replace('.json', '')] = json.load(f)
                
                # Load tool outputs
                tool_outputs_dir = analysis_dir / "tool_outputs"
                if tool_outputs_dir.exists():
                    detail['analysis']['tool_outputs'] = {}
                    for tool_output_file in tool_outputs_dir.glob("*.json"):
                        try:
                            with open(tool_output_file, 'r', encoding='utf-8') as f:
                                tool_name = tool_output_file.stem
                                detail['analysis']['tool_outputs'][tool_name] = json.load(f)
                        except Exception as e:
                            print(f"[History] Error loading tool output {tool_output_file}: {e}")
            
            # Load RAG index
            rag_index_path = session_dir / "rag_index.json"
            if rag_index_path.exists():
                with open(rag_index_path, 'r', encoding='utf-8') as f:
                    detail['rag_index'] = json.load(f)
            
            # Load progress
            progress_path = session_dir / "progress.json"
            if progress_path.exists():
                with open(progress_path, 'r', encoding='utf-8') as f:
                    detail['progress'] = json.load(f)
            
            return detail
            
        except Exception as e:
            print(f"[History] Error loading history detail for {session_id}: {e}")
            traceback.print_exc()
            return None
    
    def update_verdict(self, session_id: str, verdict: str, manually_reviewed: bool = False) -> bool:
        """
        Update the verdict for a history entry
        
        Args:
            session_id: Session ID to update
            verdict: New verdict (AUTHENTIC, COUNTERFEIT, SUSPICIOUS, etc.)
            manually_reviewed: Whether this was manually reviewed
            
        Returns:
            True if updated successfully, False otherwise
        """
        try:
            session_dir = self.history_dir / session_id
            if not session_dir.exists():
                print(f"[History] Session directory not found: {session_id}")
                return False
            
            metadata_path = session_dir / "metadata.json"
            if not metadata_path.exists():
                print(f"[History] Metadata file not found for session: {session_id}")
                return False
            
            # Load existing metadata
            with open(metadata_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            # Update verdict
            metadata['verdict'] = verdict
            if manually_reviewed:
                metadata['manually_reviewed'] = True
                metadata['manually_reviewed_at'] = datetime.now().isoformat()
            
            # Save updated metadata
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
            
            # Also update vector DB if available
            try:
                from utils.vector_db import get_vector_db
                vector_db = get_vector_db()
                if vector_db and hasattr(vector_db, 'update_verdict'):
                    # Update verdict in vector DB
                    vector_db.update_verdict(session_id, verdict, manually_reviewed)
                    print(f"[History] Updated verdict in vector DB for session {session_id}")
            except Exception as vec_error:
                print(f"[History] Warning: Failed to update vector DB: {vec_error}")
            
            print(f"[History] Successfully updated verdict for session {session_id}: {verdict}")
            return True
            
        except Exception as e:
            print(f"[History] Error updating verdict for {session_id}: {e}")
            traceback.print_exc()
            return False

