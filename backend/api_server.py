#!/usr/bin/env python3
"""
Flask API Server for Counterfeit IC Detection
Provides REST endpoints for the frontend chat interface
"""

# CRITICAL: Set matplotlib backend via environment variable BEFORE any imports
# This prevents GUI backend from being used in Flask threads (macOS requirement)
import os
os.environ['MPLBACKEND'] = 'Agg'  # Set before any matplotlib imports

# Now set it programmatically too (double safety)
import matplotlib
matplotlib.use('Agg')  # Non-GUI backend - works in threads

from flask import Flask, request, jsonify, send_file, Response, stream_with_context, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge
from pathlib import Path
import json
import uuid
from datetime import datetime
from typing import Optional, List
import sys
import time
import queue
import threading
import os

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from agents.counterfeit_detector import CounterfeitDetector
from agents.conversational_agent import get_agent
from agents.conversational_agent import get_agent

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend

# Configure maximum upload size (100MB) to handle multiple high-resolution images and PDFs
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB in bytes

# Error handler for request entity too large
@app.errorhandler(RequestEntityTooLarge)
def handle_request_entity_too_large(e):
    """Handle 413 Request Entity Too Large errors"""
    return jsonify({
        'error': 'File upload too large. Maximum size is 100MB. Please reduce the number or size of images/PDFs.',
        'status': 'failed',
        'max_size_mb': 100
    }), 413

# Initialize detector
detector = CounterfeitDetector(output_dir="api_results")

# Store active sessions
sessions = {}

# Store progress updates for each session
progress_queues = {}  # session_id -> queue.Queue


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'counterfeit-ic-detector',
        'timestamp': datetime.now().isoformat()
    })


@app.route('/api_results/<path:filename>')
def serve_result_file(filename):
    """Serve files from api_results directory"""
    # api_results is at the project root (../../api_results from backend/)
    # Try relative path first, then try parent directories
    import os
    api_results_dir = Path('api_results')
    if not api_results_dir.exists():
        # Try two levels up (from backend/ to project root)
        api_results_dir = Path(__file__).parent.parent.parent / 'api_results'
    if not api_results_dir.exists():
        # Fallback: try one level up
        api_results_dir = Path(__file__).parent.parent / 'api_results'
    
    return send_from_directory(str(api_results_dir), filename)


@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Conversational endpoint using Gemini agent
    
    Accepts:
        - message: text message (JSON)
        - session_id: session identifier (JSON)
        - chat_history: previous messages (JSON, optional)
        - image: image file (multipart/form-data, optional)
        
    Returns:
        - response: agent's response text
        - should_trigger_detection: whether to trigger detection pipeline
    """
    try:
        agent = get_agent()
        
        # Get JSON data
        data = request.get_json() or {}
        message = data.get('message', '')
        session_id = data.get('session_id', str(uuid.uuid4()))
        chat_history = data.get('chat_history', [])
        
        if not message:
            return jsonify({
                'error': 'No message provided',
                'status': 'failed'
            }), 400
        
        # Check for image upload
        has_image = False
        image_path = None
        
        if 'image' in request.files:
            image_file = request.files['image']
            if image_file.filename:
                has_image = True
                # Save temporarily
                upload_dir = Path('api_results') / 'uploads'
                upload_dir.mkdir(parents=True, exist_ok=True)
                image_path = upload_dir / f"chat_{session_id}_{image_file.filename}"
                image_file.save(str(image_path))
                image_path = str(image_path.resolve())
        
        # Get agent response
        result = agent.chat(
            message=message,
            session_id=session_id,
            chat_history=chat_history,
            has_image=has_image,
            image_path=image_path
        )
        
        return jsonify({
            'response': result['response'],
            'should_trigger_detection': result['should_trigger_detection'],
            'session_id': session_id,
            'reasoning': result.get('reasoning', '')
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/chat/clear/<session_id>', methods=['POST'])
def clear_chat_session(session_id):
    """Clear chat history for a session"""
    try:
        agent = get_agent()
        agent.clear_session(session_id)
        return jsonify({
            'status': 'success',
            'message': 'Chat session cleared'
        })
    except Exception as e:
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/detect', methods=['POST'])
def detect_counterfeit():
    """
    Main detection endpoint
    
    Accepts:
        - image: single IC image file (multipart/form-data) OR
        - images: multiple IC image files (multipart/form-data)
        
    Returns:
        - session_id: Unique session ID for tracking
        - status: 'processing' | 'completed' | 'failed'
        - message: Status message
    """
    try:
        # Collect uploaded files (support single or multiple)
        # Note: RequestEntityTooLarge will be caught by the error handler, not here
        image_files = []
        try:
            if 'images' in request.files:
                image_files = request.files.getlist('images')
            elif 'image' in request.files:
                image_files = [request.files['image']]
        except RequestEntityTooLarge:
            # Re-raise to let the error handler catch it
            raise
        
        if not image_files:
            return jsonify({
                'error': 'No image files provided',
                'status': 'failed'
            }), 400
        
        # Generate session ID
        session_id = str(uuid.uuid4())
        
        # Get PDF upload if provided
        uploaded_pdf_path = None
        if 'pdf' in request.files:
            pdf_file = request.files['pdf']
            if pdf_file.filename:
                try:
                    pdf_file.seek(0)
                    pdf_content = pdf_file.read()
                    upload_dir = Path('api_results') / 'uploads'
                    upload_dir.mkdir(parents=True, exist_ok=True)
                    pdf_path = upload_dir / f"{session_id}_uploaded_datasheet_{Path(pdf_file.filename).name}"
                    with open(pdf_path, 'wb') as f:
                        f.write(pdf_content)
                    uploaded_pdf_path = str(pdf_path.resolve())
                    print(f"[API] Uploaded PDF saved: {uploaded_pdf_path}")
                except Exception as e:
                    print(f"[API] Warning: Failed to save uploaded PDF: {e}")
                    # Continue without PDF - will scrape instead
        
        # Get additional info if provided
        additional_info = request.form.get('additional_info', '')
        
        # CRITICAL: Read file contents into memory BEFORE starting background thread
        # Flask file objects get closed when request ends, so we must read them first
        file_contents = []
        for idx, image_file in enumerate(image_files):
            if image_file.filename == '':
                return jsonify({
                    'error': f'Empty filename at index {idx}',
                    'status': 'failed'
                }), 400
            
            # Read file content into memory while request is still active
            try:
                image_file.seek(0)  # Reset to beginning
                file_content = image_file.read()  # Read all content into memory
                file_contents.append({
                    'filename': image_file.filename,
                    'content': file_content,
                    'content_type': image_file.content_type
                })
            except Exception as e:
                return jsonify({
                    'error': f'Failed to read file {image_file.filename}: {e}',
                    'status': 'failed'
                }), 400
        
        # Initialize session with progress tracking
        progress_queue = queue.Queue()
        progress_queues[session_id] = progress_queue
        
        sessions[session_id] = {
            'status': 'processing',
            'started_at': datetime.now().isoformat(),
            'progress': [],
            'current_step': 'Initializing...'
        }
        
        # Run detection in background thread
        def run_detection():
            try:
                upload_dir = Path('api_results') / 'uploads'
                upload_dir.mkdir(parents=True, exist_ok=True)
                
                # Save all images first
                all_image_paths = []
                for idx, file_data in enumerate(file_contents):
                    filename = file_data['filename']
                    file_content = file_data['content']  # Already in memory
                    
                    # Determine file extension
                    original_ext = Path(filename).suffix.lower()
                    if not original_ext or original_ext not in ['.png', '.jpg', '.jpeg', '.webp']:
                        original_ext = '.png'  # Default to PNG
                    
                    image_path = upload_dir / f"{session_id}_{idx}_{Path(filename).stem}{original_ext}"
                    
                    # Write file content from memory to disk
                    try:
                        import os
                        with open(image_path, 'wb') as f:
                            f.write(file_content)
                            # Ensure file is written to disk BEFORE closing
                            os.fsync(f.fileno())
                    except Exception as save_err:
                        error_msg = f'Failed to save image file: {save_err}'
                        print(f"[API] {error_msg}")
                        import traceback
                        traceback.print_exc()
                        progress_queue.put({
                            'type': 'error',
                            'message': error_msg
                        })
                        return
                    
                    # Convert to absolute path immediately
                    image_path = image_path.resolve()
                    
                    # Normalize to PNG if needed
                    if image_path.suffix.lower() != '.png':
                        try:
                            from PIL import Image
                            # Use context manager to ensure file is properly closed
                            with Image.open(image_path) as img:
                                img_rgb = img.convert('RGB')
                                png_path = image_path.with_suffix('.png')
                                img_rgb.save(str(png_path))
                                image_path = png_path.resolve()
                        except Exception as conv_err:
                            print(f"[API] Warning: failed to convert to PNG ({conv_err})")
                            import traceback
                            traceback.print_exc()
                    
                    # Ensure file exists and is readable before detection
                    if not image_path.exists():
                        raise FileNotFoundError(f"Saved image file not found: {image_path}")
                    
                    # Verify file is readable
                    try:
                        with open(image_path, 'rb') as test_file:
                            test_file.read(1)  # Try to read at least 1 byte
                    except Exception as e:
                        raise IOError(f"Cannot read image file {image_path}: {e}")
                    
                    all_image_paths.append(str(image_path))
                
                # Run detection with all images (multiple views)
                # Pass uploaded PDF path and additional info
                if not all_image_paths:
                    raise ValueError("No image paths available for detection")
                
                result = _detect_with_progress(
                    detector, 
                    all_image_paths[0],  # Primary image (guaranteed to exist)
                    session_id, 
                    progress_queue,
                    all_image_paths=all_image_paths,  # All images for multi-view analysis
                    uploaded_pdf_path=uploaded_pdf_path,
                    additional_info=additional_info
                )
                
                chat_response = generate_chat_response(result)
                # Ensure report_path is absolute for storage
                report_path_stored = getattr(result, 'report_path', None)
                if report_path_stored:
                    report_path_stored = str(Path(report_path_stored).resolve())
                
                results_list = [{
                    'verdict': result.verdict,
                    'score': result.authenticity_score,
                    'part_number': result.part_number,
                    'manufacturer': result.manufacturer,
                    'package_type': result.package_type,
                    'anomalies_count': len(result.anomalies),
                    'report_path': report_path_stored,
                    'chat_response': chat_response,
                    'dimension_viz': getattr(result, 'dimension_visualization', None)
                }]
                
                # Mark as completed
                sessions[session_id].update({
                    'status': 'completed',
                    'results': results_list,
                    'completed_at': datetime.now().isoformat(),
                    'current_step': 'Complete'
                })
                progress_queue.put({
                    'type': 'complete',
                    'session_id': session_id
                })
                
            except Exception as e:
                import traceback
                error_trace = traceback.format_exc()
                error_msg = str(e)
                print(f"[API] Error in background detection thread: {error_msg}")
                print(f"[API] Traceback:\n{error_trace}")
                sessions[session_id].update({
                    'status': 'failed',
                    'error': error_msg,
                    'failed_at': datetime.now().isoformat(),
                    'traceback': error_trace
                })
                progress_queue.put({
                    'type': 'error',
                    'message': error_msg
                })
        
        # Start background thread
        thread = threading.Thread(target=run_detection, daemon=True)
        thread.start()
        
        # Return immediately with session ID
        return jsonify({
            'session_id': session_id,
            'status': 'processing',
            'message': 'Detection started'
        })
            
    except RequestEntityTooLarge:
        # Re-raise to let the error handler catch it
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[API] Error in /api/detect endpoint: {e}")
        print(f"[API] Traceback:\n{error_trace}")
        return jsonify({
            'error': str(e),
            'status': 'failed',
            'traceback': error_trace
        }), 500


def _detect_with_progress(detector, image_path: str, session_id: str, progress_queue: queue.Queue, 
                          uploaded_pdf_path: Optional[str] = None, additional_info: Optional[str] = None,
                          all_image_paths: Optional[List[str]] = None):
    """Run detection and emit progress updates
    
    Args:
        detector: CounterfeitDetector instance
        image_path: Path to primary IC image (for backward compatibility)
        session_id: Session ID for tracking
        progress_queue: Queue for progress updates
        uploaded_pdf_path: Optional path to uploaded OEM PDF (if provided, skip scraping)
        additional_info: Optional additional information about the IC
        all_image_paths: Optional list of all IC image paths (multiple views)
    """
    from agents.counterfeit_detector import DetectionResult
    import time
    from pathlib import Path
    import traceback
    
    try:
        start_time = time.time()
        
        # Use all_image_paths if provided, otherwise use single image_path
        if all_image_paths:
            image_paths = [Path(p) for p in all_image_paths]
            primary_image_path = image_paths[0]
        else:
            primary_image_path = Path(image_path)
            image_paths = [primary_image_path]
        
        # Ensure primary file exists and is readable
        if not primary_image_path.exists():
            raise FileNotFoundError(f"Image file not found: {primary_image_path}")
        
        result = DetectionResult(
            ic_image_path=str(primary_image_path),
            ic_image_paths=[str(p) for p in image_paths],  # All images for multi-view analysis
            timestamp=datetime.now().isoformat(),
            anomalies=[],
            additional_info=additional_info  # Store additional info if provided
        )
        
        # STEP 1: IC Identification
        progress_queue.put({
            'type': 'step',
            'step': 'identify',
            'title': 'Identifying IC',
            'status': 'running',
            'message': 'Analyzing IC image with Gemini...'
        })
        # Use primary image for identification (can be enhanced to use all images)
        image_path_abs = primary_image_path.resolve()
        if not image_path_abs.exists():
            raise FileNotFoundError(f"Image file not found: {image_path_abs}")
        
        # Pass all images and additional info to identification for better context
        ic_info = detector._identify_ic(image_path_abs, additional_info=additional_info, all_images=image_paths)
        result.part_number = ic_info.get('part_number', 'UNKNOWN')
        result.manufacturer = ic_info.get('manufacturer', 'UNKNOWN')
        result.package_type = ic_info.get('package_type', 'UNKNOWN')
        result.pin_count = ic_info.get('pin_count', 0)
        progress_queue.put({
            'type': 'step',
            'step': 'identify',
            'title': 'Identifying IC',
            'status': 'completed',
            'message': f'Identified: {result.part_number} ({result.manufacturer})',
            'data': ic_info  # Send full ic_info including date_codes, lot_codes, etc.
        })
        
        # STEP 2: Datasheet - Use uploaded PDF or scrape
        if uploaded_pdf_path and Path(uploaded_pdf_path).exists():
            # User uploaded OEM PDF - skip scraping
            progress_queue.put({
                'type': 'step',
                'step': 'scrape',
                'title': 'Using Uploaded OEM Datasheet',
                'status': 'completed',
                'message': 'Using uploaded OEM datasheet',
                'data': {
                    'datasheet_path': uploaded_pdf_path,
                    'source': 'uploaded'
                }
            })
            datasheet_path = str(Path(uploaded_pdf_path).resolve())
            result.datasheet_path = datasheet_path
        else:
            # No uploaded PDF - scrape for datasheet
            progress_queue.put({
                'type': 'step',
                'step': 'scrape',
                'title': 'Searching OEM Datasheet',
                'status': 'running',
                'message': f'Searching for {result.part_number} datasheet...'
            })
            datasheet_path = detector._scrape_datasheet(result.part_number)
            # Convert to absolute path to avoid issues in background thread
            if datasheet_path:
                datasheet_path = str(Path(datasheet_path).resolve())
            result.datasheet_path = datasheet_path
            if datasheet_path:
                progress_queue.put({
                    'type': 'step',
                    'step': 'scrape',
                    'title': 'Searching OEM Datasheet',
                    'status': 'completed',
                    'message': 'Datasheet retrieved successfully',
                    'data': {
                        'datasheet_path': datasheet_path,
                        'source': 'scraped'
                    }
                })
            else:
                progress_queue.put({
                    'type': 'step',
                    'step': 'scrape',
                    'title': 'Searching OEM Datasheet',
                    'status': 'completed',
                    'message': 'No datasheet found (will proceed without it)'
                })
        
        # STEP 3: Datasheet Parsing
        mechanical_diagram = None
        parsed_specs = None
        if datasheet_path:
            # Ensure PDF file exists and is readable
            pdf_path_obj = Path(datasheet_path)
            if not pdf_path_obj.exists():
                raise FileNotFoundError(f"Datasheet PDF not found: {datasheet_path}")
            
            progress_queue.put({
                'type': 'step',
                'step': 'parse',
                'title': 'Extracting Parameters',
                'status': 'running',
                'message': 'Parsing datasheet and extracting mechanical diagrams...'
            })
            mechanical_diagram, parsed_specs = detector._parse_datasheet(
                str(pdf_path_obj.resolve()), result.part_number, result.package_type, result.pin_count, result.manufacturer
            )
            result.mechanical_diagram_path = mechanical_diagram
            result.parsed_specs = parsed_specs
            progress_queue.put({
                'type': 'step',
                'step': 'parse',
                'title': 'Extracting Parameters',
                'status': 'completed',
                'message': 'Mechanical specifications extracted',
                'data': {
                    'mechanical_diagram': mechanical_diagram,
                    'datasheet_path': datasheet_path,
                    'parsed_specs': parsed_specs
                }
            })
        
        # STEP 4: Dimension Analysis
        progress_queue.put({
            'type': 'step',
            'step': 'dimension',
            'title': 'Dimension Analysis',
            'status': 'running',
            'message': 'Measuring IC body dimensions...'
        })
        dimension_dict, dim_viz = detector._estimate_dimensions(image_path, result)
        result.dimension_analysis = dimension_dict
        result.dimension_visualization = dim_viz
        if dim_viz:
            # Convert to relative path for frontend
            try:
                dim_viz_path = Path(dim_viz)
                api_results_path = Path('api_results').resolve()
                
                # Get the filename or relative path
                if dim_viz_path.is_absolute():
                    try:
                        # Try to get relative path from api_results
                        dim_viz_rel = str(dim_viz_path.relative_to(api_results_path))
                    except ValueError:
                        # Path is not under api_results, check if it contains api_results
                        path_str = str(dim_viz_path)
                        if 'api_results' in path_str:
                            # Extract the part after api_results
                            parts = path_str.split('api_results')
                            if len(parts) > 1:
                                dim_viz_rel = parts[-1].lstrip('/\\')
                            else:
                                dim_viz_rel = dim_viz_path.name
                        else:
                            dim_viz_rel = dim_viz_path.name
                else:
                    # Already relative, remove 'api_results/' prefix if present
                    dim_viz_rel = str(dim_viz_path)
                    # Remove 'api_results/' prefix if present (handle both / and \)
                    if dim_viz_rel.startswith('api_results/'):
                        dim_viz_rel = dim_viz_rel[len('api_results/'):]
                    elif dim_viz_rel.startswith('api_results\\'):
                        dim_viz_rel = dim_viz_rel[len('api_results\\'):]
                    # Also handle if it starts with just the filename
                    if '/' not in dim_viz_rel and '\\' not in dim_viz_rel:
                        # It's just a filename, that's fine
                        pass
                
                # Ensure forward slashes for URL
                dim_viz_rel = dim_viz_rel.replace('\\', '/')
                # Remove any leading slashes
                dim_viz_rel = dim_viz_rel.lstrip('/')
                
                # Use /api/download endpoint for consistency
                from urllib.parse import quote
                dim_viz_rel_encoded = quote(dim_viz_rel, safe='')
                viz_url = f'http://localhost:5001/api/download?file={dim_viz_rel_encoded}'
                
                print(f"[API] Dimension viz URL: {viz_url} (from path: {dim_viz}, relative: {dim_viz_rel})")
            except Exception as e:
                print(f"[API] Error processing visualization path: {e}")
                import traceback
                traceback.print_exc()
                viz_url = None
            
            progress_queue.put({
                'type': 'step',
                'step': 'dimension',
                'title': 'Dimension Analysis',
                'status': 'completed',
                'message': f'Dimensions: AR = {dimension_dict.get("measured_aspect_ratio", "N/A"):.2f}',
                'visualization': viz_url,
                'data': dimension_dict
            })
        else:
            progress_queue.put({
                'type': 'step',
                'step': 'dimension',
                'title': 'Dimension Analysis',
                'status': 'completed',
                'message': 'Dimension analysis complete'
            })
        
        # STEP 5: Visual Analysis
        progress_queue.put({
            'type': 'step',
            'step': 'visual',
            'title': 'Visual Comparison',
            'status': 'running',
            'message': 'Comparing IC with datasheet using Gemini...'
        })
        # Pass all images for multi-view analysis
        visual_result = detector._gemini_visual_analysis(
            primary_image_path, mechanical_diagram, parsed_specs, result,
            dimension_analysis=dimension_dict,
            datasheet_pdf_path=result.datasheet_path,
            all_images=image_paths,  # Pass all images for comprehensive analysis
            additional_info=additional_info
        )
        result.visual_comparison = visual_result
        result.anomalies = visual_result.get('anomalies', [])
        progress_queue.put({
            'type': 'step',
            'step': 'visual',
            'title': 'Visual Comparison',
            'status': 'completed',
            'message': f'Analysis complete: {len(result.anomalies)} anomalies detected',
            'data': {
                'anomalies_count': len(result.anomalies)
            }
        })
        
        # STEP 6: Final Verdict
        progress_queue.put({
            'type': 'step',
            'step': 'verdict',
            'title': 'Calculating Verdict',
            'status': 'running',
            'message': 'Computing authenticity score...'
        })
        detector._calculate_verdict(result)
        progress_queue.put({
            'type': 'step',
            'step': 'verdict',
            'title': 'Calculating Verdict',
            'status': 'completed',
            'message': f'Verdict: {result.verdict} (Score: {result.authenticity_score:.1f}/100)',
            'data': {
                'verdict': result.verdict,
                'score': result.authenticity_score
            }
        })
        
        # STEP 7: Report Generation
        progress_queue.put({
            'type': 'step',
            'step': 'report',
            'title': 'Generating Report',
            'status': 'running',
            'message': 'Creating PDF report...'
        })
        report_path = detector._generate_report(result)
        result.report_path = report_path
        
        # Convert to relative path if absolute (for storage)
        if report_path and Path(report_path).is_absolute():
            api_results_path = Path('api_results').resolve()
            try:
                report_path_rel = str(Path(report_path).relative_to(api_results_path))
            except ValueError:
                # If not under api_results, use filename
                report_path_rel = Path(report_path).name
        else:
            report_path_rel = report_path
        
        progress_queue.put({
            'type': 'step',
            'step': 'report',
            'title': 'Generating Report',
            'status': 'completed',
            'message': 'PDF report generated',
            'data': {
                'report_path': report_path_rel if report_path_rel else report_path
            }
        })
        
        # Store absolute path in result object for later retrieval
        result.report_path = report_path
        
        result.processing_time_seconds = time.time() - start_time
        return result
        
    except Exception as e:
        error_msg = str(e)
        error_trace = traceback.format_exc()
        print(f"[API] Error in _detect_with_progress: {error_msg}")
        print(f"[API] Full traceback:")
        print(error_trace)
        
        # Check if it's a file I/O error
        if 'closed file' in error_msg.lower() or 'I/O operation' in error_msg:
            print(f"[API] File I/O error detected. Image path: {image_path if 'image_path' in locals() else 'unknown'}")
            if 'image_path' in locals():
                print(f"[API] Image path exists: {image_path.exists() if hasattr(image_path, 'exists') else 'N/A'}")
                print(f"[API] Image path absolute: {image_path.resolve() if hasattr(image_path, 'resolve') else 'N/A'}")
        
        # Emit error to progress queue with more details
        progress_queue.put({
            'type': 'error',
            'message': f'Detection failed: {error_msg}',
            'error_type': type(e).__name__,
            'traceback': error_trace[-500:] if len(error_trace) > 500 else error_trace  # Last 500 chars
        })
        
        # Return a minimal result with error info
        from agents.counterfeit_detector import DetectionResult
        error_result = DetectionResult(
            ic_image_path=str(image_path.resolve()) if 'image_path' in locals() and hasattr(image_path, 'resolve') else 'unknown',
            timestamp=datetime.now().isoformat(),
            anomalies=[],
            verdict='ERROR',
            authenticity_score=0.0,
            reasoning=f'Error during detection: {error_msg}'
        )
        return error_result


@app.route('/api/progress/<session_id>', methods=['GET'])
def get_progress(session_id):
    """Get progress updates for a session (polling endpoint)"""
    if session_id not in sessions:
        # Return empty updates instead of 404 to allow graceful handling
        return jsonify({
            'updates': [],
            'error': 'Session not found',
            'session': None
        }), 404
    
    if session_id not in progress_queues:
        return jsonify({
            'updates': [],
            'session': sessions[session_id]
        })
    
    # Get all pending updates from queue
    updates = []
    progress_queue = progress_queues[session_id]
    
    try:
        while True:
            try:
                update = progress_queue.get_nowait()
                updates.append(update)
                # Update session progress
                if 'step' in update:
                    if session_id in sessions:
                        if 'progress' not in sessions[session_id]:
                            sessions[session_id]['progress'] = []
                        sessions[session_id]['progress'].append(update)
                        if update.get('status') == 'running':
                            sessions[session_id]['current_step'] = update.get('title', 'Processing...')
            except queue.Empty:
                break
    except Exception as e:
        print(f"[API] Error getting progress: {e}")
    
    return jsonify({
        'updates': updates,
        'session': sessions[session_id]
    })


@app.route('/api/session/<session_id>', methods=['GET'])
def get_session(session_id):
    """Get session status and results"""
    if session_id not in sessions:
        return jsonify({
            'error': 'Session not found',
            'status': 'not_found'
        }), 404
    
    session = sessions[session_id]
    
    response = {
        'session_id': session_id,
        'status': session['status'],
        'started_at': session['started_at']
    }
    
    if session['status'] == 'completed':
        results_list = session.get('results', [])
        response['results'] = results_list
    elif session['status'] == 'failed':
        response['error'] = session.get('error', 'Unknown error')
    
    return jsonify(response)


@app.route('/api/download', methods=['GET'])
def download_file():
    """Download a file by path (relative to api_results or absolute)"""
    file_path = request.args.get('file')
    if not file_path:
        return jsonify({'error': 'No file specified'}), 400
    
    # Find api_results directory (it's at project root, not relative to backend/)
    api_results_path = Path('api_results')
    if not api_results_path.exists():
        # Try two levels up (from backend/ to project root)
        api_results_path = Path(__file__).parent.parent.parent / 'api_results'
    if not api_results_path.exists():
        # Fallback: try one level up
        api_results_path = Path(__file__).parent.parent / 'api_results'
    
    api_results_path = api_results_path.resolve()
    
    # Handle both relative and absolute paths
    if Path(file_path).is_absolute():
        full_path = Path(file_path)
    else:
        # Relative to api_results directory
        full_path = api_results_path / file_path
    
    # Security: ensure path is within api_results
    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(api_results_path)):
            return jsonify({'error': 'Access denied'}), 403
    except:
        return jsonify({'error': 'Invalid path'}), 400
    
    if not full_path.exists():
        return jsonify({'error': 'File not found'}), 404
    
    # Determine MIME type
    mimetype = 'application/octet-stream'
    if full_path.suffix == '.pdf':
        mimetype = 'application/pdf'
    elif full_path.suffix in ['.png', '.jpg', '.jpeg']:
        mimetype = f'image/{full_path.suffix[1:]}'
    
    return send_file(
        str(full_path),
        mimetype=mimetype,
        as_attachment=False  # Display in browser for images
    )


@app.route('/api/report/<session_id>', methods=['GET'])
def download_report(session_id):
    """Download PDF report for a session"""
    if session_id not in sessions:
        return jsonify({
            'error': 'Session not found'
        }), 404
    
    session = sessions[session_id]
    
    if session['status'] != 'completed':
        return jsonify({
            'error': 'Report not ready yet'
        }), 400
    
    # Get report path from results (results is a list, get first result)
    results = session.get('results', [])
    if not results:
        return jsonify({
            'error': 'No results found'
        }), 404
    
    # Get report_path from the first result
    report_path = results[0].get('report_path') if isinstance(results[0], dict) else None
    
    if not report_path:
        return jsonify({
            'error': 'Report path not found in results'
        }), 404
    
    # Handle both relative and absolute paths
    if Path(report_path).is_absolute():
        full_path = Path(report_path)
    else:
        # Relative to api_results directory
        api_results_path = Path('api_results').resolve()
        full_path = api_results_path / report_path
    
    if not full_path.exists():
        # Try to find the report file with a pattern match
        api_results_path = Path('api_results').resolve()
        pattern = f"*{session_id}*.pdf"
        matching_files = list(api_results_path.glob(pattern))
        if matching_files:
            full_path = matching_files[0]
        else:
            return jsonify({
                'error': f'Report file not found at {full_path}'
        }), 404
    
    return send_file(
        str(full_path),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f"counterfeit_report_{session_id}.pdf"
    )


def generate_chat_response(result) -> list:
    """
    Generate a chat-style conversational response from detection results
    
    Returns:
        List of message objects for chat UI
    """
    messages = []
    
    # Step 1: IC Identification
    part_num = result.part_number or "UNKNOWN"
    manufacturer = result.manufacturer or "UNKNOWN"
    package_type = result.package_type or "UNKNOWN"
    pin_count = result.pin_count or 0
    
    messages.append({
        'type': 'step',
        'title': '🔍 IC Identification',
        'content': f"I've identified this as a **{part_num}** from **{manufacturer}**.\n\n"
                   f"📦 Package: {package_type}\n"
                   f"📌 Pin Count: {pin_count}"
    })
    
    # Step 2: Datasheet Analysis
    if result.datasheet_path:
        messages.append({
            'type': 'step',
            'title': '📥 Datasheet Retrieved',
            'content': f"I've downloaded the official OEM datasheet and extracted the mechanical specifications."
        })
    
    # Step 3: Dimension Analysis
    if result.dimension_analysis:
        dim = result.dimension_analysis
        dim_source = dim.get('dimension_source', 'unknown')
        
        if dim_source == 'gemini_extraction':
            source_text = "extracted from the datasheet diagram using OCR"
        elif dim_source == 'datasheet_parser':
            source_text = "parsed from the datasheet"
        else:
            source_text = "estimated from typical package dimensions"
        
        # Safely format aspect ratios (handle None values)
        expected_ar = dim.get('expected_aspect_ratio')
        expected_ar_str = f"{expected_ar:.2f}" if expected_ar is not None and isinstance(expected_ar, (int, float)) else "N/A"
        
        measured_ar = dim.get('measured_aspect_ratio')
        measured_ar_str = f"{measured_ar:.2f}" if measured_ar is not None and isinstance(measured_ar, (int, float)) else "N/A"
        
        confidence_score = dim.get('confidence_score', 0) or 0
        
        messages.append({
            'type': 'step',
            'title': '📐 Dimension Analysis',
            'content': f"**Expected Aspect Ratio:** {expected_ar_str} ({source_text})\n"
                       f"**Measured Aspect Ratio:** {measured_ar_str}\n"
                       f"**Match Score:** {confidence_score:.1f}/100\n\n"
                       f"{'✅ Dimensions match expected values' if confidence_score > 80 else '⚠️ Dimensional discrepancy detected'}"
        })
    
    # Step 4: Visual Analysis
    if result.visual_comparison:
        visual = result.visual_comparison
        text_score = visual.get('text_quality_score') or 0
        if not isinstance(text_score, (int, float)):
            text_score = 0
        
        messages.append({
            'type': 'step',
            'title': '👁️ Visual Analysis',
            'content': f"**Text Quality:** {text_score}/100\n"
                       f"**Pin Count Verified:** {'✅ Yes' if visual.get('pin_count_verified') else '❌ No'}\n"
                       f"**Package Type Verified:** {'✅ Yes' if visual.get('package_type_verified') else '❌ No'}\n\n"
                       f"**Key Observations:**\n" + 
                       '\n'.join([f"• {obs}" for obs in visual.get('observations', [])[:3] if obs])
        })
    
    # Step 5: Anomalies
    if result.anomalies:
        anomaly_text = f"⚠️ **{len(result.anomalies)} anomal{'y' if len(result.anomalies) == 1 else 'ies'} detected:**\n\n"
        
        for i, anomaly in enumerate(result.anomalies[:3], 1):
            severity_emoji = {'high': '🔴', 'medium': '🟡', 'low': '🟢'}.get(anomaly.get('severity', 'medium'), '🟡')
            anomaly_text += f"{severity_emoji} **{anomaly.get('type', 'Unknown').replace('_', ' ').title()}** ({anomaly.get('severity', 'medium')} severity)\n"
            anomaly_text += f"   {anomaly.get('description', 'No description')[:150]}...\n\n"
        
        messages.append({
            'type': 'warning',
            'title': '⚠️ Anomalies Detected',
            'content': anomaly_text
        })
    else:
        messages.append({
            'type': 'success',
            'title': '✅ No Anomalies',
            'content': 'No suspicious features detected in the visual analysis.'
        })
    
    # Final Verdict
    verdict = result.verdict or "UNKNOWN"
    verdict_emoji = {
        'AUTHENTIC': '✅',
        'LIKELY AUTHENTIC': '✅',
        'SUSPICIOUS': '⚠️',
        'SUSPICIOUS - REQUIRES INSPECTION': '⚠️',
        'COUNTERFEIT': '❌',
        'LIKELY COUNTERFEIT': '❌'
    }.get(verdict, '❓')
    
    # Safely format authenticity score
    auth_score = result.authenticity_score
    if auth_score is None or not isinstance(auth_score, (int, float)):
        auth_score = 0
    auth_score_str = f"{auth_score:.1f}"
    
    reasoning = getattr(result, 'reasoning', '') or ''
    
    # Build conversational summary from all messages
    summary_parts = []
    
    # Add identification
    if part_num != "UNKNOWN":
        summary_parts.append(f"I've identified this IC as **{part_num}** from **{manufacturer}**. "
                           f"The package type is **{package_type}** with **{pin_count} pins**.")
    
    # Add datasheet info
    if result.datasheet_path:
        summary_parts.append("I've successfully retrieved and parsed the official OEM datasheet, extracting mechanical specifications and package dimensions.")
    
    # Add dimension analysis
    if result.dimension_analysis:
        dim = result.dimension_analysis
        expected_ar = dim.get('expected_aspect_ratio')
        measured_ar = dim.get('measured_aspect_ratio')
        dim_score = dim.get('dimension_score', 0) or dim.get('confidence_score', 0) or 0
        
        if expected_ar and measured_ar:
            summary_parts.append(f"📐 **Dimension Analysis:** The expected aspect ratio from the datasheet is **{expected_ar:.2f}**, "
                               f"while the measured aspect ratio is **{measured_ar:.2f}**. "
                               f"This gives a dimension match score of **{dim_score:.1f}/100**.")
        elif measured_ar:
            summary_parts.append(f"📐 **Dimension Analysis:** I measured an aspect ratio of **{measured_ar:.2f}** "
                               f"(score: **{dim_score:.1f}/100**).")
    
    # Add visual analysis
    if result.visual_comparison:
        visual = result.visual_comparison
        summary = visual.get('summary', '')
        if summary:
            # Smart truncation: try to end at sentence boundary, max 200 chars
            if len(summary) > 200:
                truncated = summary[:200]
                last_period = truncated.rfind('.')
                last_exclamation = truncated.rfind('!')
                last_question = truncated.rfind('?')
                last_sentence_end = max(last_period, last_exclamation, last_question)
                if last_sentence_end > 150:  # Only use if we have enough content
                    summary = summary[:last_sentence_end + 1]
                else:
                    summary = truncated + '...'
            summary_parts.append(f"👁️ **Visual Analysis:** {summary}")
    
    # Add anomalies
    if result.anomalies:
        anomaly_count = len(result.anomalies)
        anomaly_text = f"⚠️ I detected **{anomaly_count} anomal{'y' if anomaly_count == 1 else 'ies'}** during the analysis:\n\n"
        
        for i, anomaly in enumerate(result.anomalies[:3], 1):
            severity_emoji = {'high': '🔴', 'medium': '🟡', 'low': '🟢'}.get(anomaly.get('severity', 'medium'), '🟡')
            anomaly_text += f"{severity_emoji} **{anomaly.get('type', 'Unknown').replace('_', ' ').title()}** ({anomaly.get('severity', 'medium')} severity)\n"
            desc = anomaly.get('description', 'No description')
            # Smart truncation: try to end at sentence boundary, max 150 chars
            if len(desc) > 150:
                truncated = desc[:150]
                last_period = truncated.rfind('.')
                last_exclamation = truncated.rfind('!')
                last_question = truncated.rfind('?')
                last_sentence_end = max(last_period, last_exclamation, last_question)
                if last_sentence_end > 100:  # Only use if we have enough content
                    desc = desc[:last_sentence_end + 1]
                else:
                    desc = truncated + '...'
            anomaly_text += f"   {desc}\n\n"
        
        summary_parts.append(anomaly_text)
    else:
        summary_parts.append("✅ **No Anomalies:** I didn't detect any suspicious features in the visual analysis.")
    
    # Add final verdict
    final_summary = '\n\n'.join(summary_parts)
    final_summary += f"\n\n{verdict_emoji} **Final Verdict: {verdict}**\n\n"
    final_summary += f"**Authenticity Score:** {auth_score_str}/100\n\n"
    if reasoning:
        final_summary += f"{reasoning}\n\n"
    
    final_summary += "\n\n📄 **Download Report**\n\nA detailed PDF report with annotated images and comprehensive analysis is available for download below."
    
    # Return as single conversational message (not a list of messages)
    return [{
        'type': 'summary',
        'content': final_summary  # No title needed - content is self-contained
    }]


if __name__ == '__main__':
    print("=" * 70)
    print("🚀 Counterfeit IC Detection API Server")
    print("=" * 70)
    print(f"Starting server on http://localhost:5001")
    print(f"API Endpoints:")
    print(f"  - POST /api/detect     : Upload IC image for detection")
    print(f"  - POST /api/chat       : Conversational agent endpoint")
    print(f"  - POST /api/chat/clear/:id : Clear chat session")
    print(f"  - GET  /api/session/:id : Get session status")
    print(f"  - GET  /api/report/:id  : Download PDF report")
    print("=" * 70)
    
    # Configure for long-running requests (detection takes 25-40 seconds)
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)

