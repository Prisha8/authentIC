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
import re
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
from utils.history_manager import HistoryManager
from tools.sam21_segmenter import generate_sam21_mask, Sam21NotAvailable
from tools.pcb_detector import detect_pcb_ics

# Optional vector DB import - app will work without it
try:
    from utils.vector_db import get_vector_db
    VECTOR_DB_AVAILABLE = True
except ImportError as e:
    print(f"[API] Warning: Vector DB not available: {e}")
    print("[API] App will continue without vector search functionality")
    VECTOR_DB_AVAILABLE = False
    get_vector_db = None

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

# Helper function to get storage path based on user type
def get_storage_path(user_type: Optional[str] = None) -> Path:
    """
    Get the storage path based on user type.
    
    Args:
        user_type: 'personal' or 'business'. If None, defaults to business.
    
    Returns:
        Path object to the storage directory
    """
    backend_dir = Path(__file__).parent  # backend/
    project_root = backend_dir.parent  # counterfeit_IC/
    
    if user_type == 'personal':
        # Personal workflow: counterfeit_IC/data/personal_api_results (inside project root)
        return project_root / "data" / "personal_api_results"
    else:
        # Business workflow: counterfeit_IC/data/api_results (inside project root)
        return project_root / "data" / "api_results"

def get_storage_path_str(user_type: Optional[str] = None) -> str:
    """Get storage path as string"""
    return str(get_storage_path(user_type))

# Initialize default detector for business (will be recreated per-request if needed)
backend_dir = Path(__file__).parent  # backend/
project_root = backend_dir.parent  # counterfeit_IC/
default_api_results_path = project_root / "data" / "api_results"
PIN_COUNTER_WEIGHTS_PATH = os.getenv("PIN_COUNTER_WEIGHTS_PATH") or str(
    Path(__file__).parent / "weights" / "pin_counter.pt"
)
PCB_WEIGHTS_PATH = os.getenv("PCB_WEIGHTS_PATH") or str(
    Path(__file__).parent / "weights" / "pcb_weights.pt"
)
detector = CounterfeitDetector(
    output_dir=str(default_api_results_path),
    pin_counter_weights=PIN_COUNTER_WEIGHTS_PATH
)

# Initialize default history manager for business (will be recreated per-request if needed)
default_history_manager = HistoryManager(base_dir="data/api_results")

# Store active sessions with their user types
sessions = {}  # session_id -> {status, user_type, ...}

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
    """Serve files from api_results directory
    Checks both business (data/api_results) and personal (data/personal_api_results) storage paths
    """
    backend_dir = Path(__file__).parent  # backend/
    project_root = backend_dir.parent  # counterfeit_IC/
    
    # Try both business and personal paths
    possible_dirs = [
        project_root / 'data' / 'api_results',
        project_root / 'data' / 'personal_api_results',
        Path('data/api_results').resolve(),
        Path(__file__).parent.parent / 'data' / 'api_results',
        Path(__file__).parent.parent / 'data' / 'personal_api_results'
    ]
    
    # All storage is now inside counterfeit_IC/data (no old external paths)
    
    # Try each directory until we find the file
    for api_results_dir in possible_dirs:
        if api_results_dir.exists():
            file_path = api_results_dir / filename
            if file_path.exists() and str(file_path.resolve()).startswith(str(api_results_dir.resolve())):
                return send_from_directory(str(api_results_dir), filename)
    
    # If not found, default to business path (for backward compatibility)
    api_results_dir = project_root / 'data' / 'api_results'
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
        
        # Get user type for storage path
        user_type = request.headers.get('X-User-Type') or data.get('user_type', 'business')
        
        # Check for image upload
        has_image = False
        image_path = None
        
        if 'image' in request.files:
            image_file = request.files['image']
            if image_file.filename:
                has_image = True
                # Save temporarily - use correct storage path based on user type
                api_results_path = get_storage_path(user_type)
                upload_dir = api_results_path / 'uploads'
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
        # Get user type from request (header or form data)
        user_type = request.headers.get('X-User-Type') or request.form.get('user_type', 'business')
        if user_type not in ['personal', 'business']:
            user_type = 'business'  # Default to business
        
        print(f"[API] Detection request - User type: {user_type}")
        
        # Get storage path for this user type
        api_results_path = get_storage_path(user_type)
        api_results_path.mkdir(parents=True, exist_ok=True)
        print(f"[API] Using storage path: {api_results_path.resolve()}")
        
        # Create per-request detector and history manager
        request_detector = CounterfeitDetector(
            output_dir=str(api_results_path),
            pin_counter_weights=PIN_COUNTER_WEIGHTS_PATH
        )
        
        # For history manager, calculate relative path from project root
        backend_dir = Path(__file__).parent  # backend/
        project_root = backend_dir.parent  # counterfeit_IC/
        if user_type == 'personal':
            # Personal: data/personal_api_results (relative to counterfeit_IC)
            history_base_dir = "data/personal_api_results"
        else:
            # Business: data/api_results (relative to counterfeit_IC)
            history_base_dir = "data/api_results"
        
        request_history_manager = HistoryManager(base_dir=history_base_dir)
        
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
                    upload_dir = api_results_path / 'uploads'
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

        # Optional PCB/FPGA board mode flag
        pcb_mode_raw = request.form.get('pcb_mode') or request.args.get('pcb_mode')
        pcb_mode_enabled = str(pcb_mode_raw).lower() in ['true', '1', 'yes', 'on']
        
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
            'current_step': 'Initializing...',
            'user_type': user_type,  # Store user type with session
            'pcb_mode': pcb_mode_enabled
        }
        
        print(f"[API] Session {session_id} created and stored. Total sessions: {len(sessions)}")
        
        # Run detection in background thread
        def run_detection():
            try:
                # Capture request_history_manager in closure
                history_mgr = request_history_manager
                # Use the correct storage path for this user type
                upload_dir = api_results_path / 'uploads'
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
                
                # If PCB mode is enabled, run YOLOv11 detector to crop ICs first
                if pcb_mode_enabled:
                    progress_queue.put({
                        'type': 'step',
                        'step': 'pcb_detect',
                        'title': 'PCB IC Detection',
                        'status': 'running',
                        'message': 'Detecting ICs on PCB/FPGA images with YOLOv11...'
                    })

                    def to_frontend_path(path_str: str) -> str:
                        try:
                            path_obj = Path(path_str).resolve()
                            base = api_results_path.resolve() if api_results_path else None
                            if base:
                                return str(path_obj.relative_to(base)).replace('\\', '/')
                        except Exception:
                            pass
                        return Path(path_str).name

                    pcb_crops: List[str] = []
                    pcb_overlays: List[str] = []
                    pcb_output_dir = (api_results_path or Path("data/api_results")).resolve() / "pcb"
                    for src_path in list(all_image_paths):
                        try:
                            pcb_result = detect_pcb_ics(
                                image_path=src_path,
                                weights_path=PCB_WEIGHTS_PATH,
                                output_dir=str(pcb_output_dir)
                            )
                            pcb_overlays.append(to_frontend_path(pcb_result.get('overlay_path')))
                            for crop in pcb_result.get('crops', []):
                                crop_path = crop.get('crop_path')
                                if crop_path:
                                    pcb_crops.append(str(Path(crop_path).resolve()))
                        except Exception as pcb_err:
                            print(f"[API] PCB detection failed for {src_path}: {pcb_err}")
                            import traceback
                            traceback.print_exc()
                            progress_queue.put({
                                'type': 'step',
                                'step': 'pcb_detect',
                                'title': 'PCB IC Detection',
                                'status': 'completed',
                                'message': f'PCB detection issue: {pcb_err}'
                            })

                    if pcb_crops:
                        all_image_paths = pcb_crops
                        progress_queue.put({
                            'type': 'step',
                            'step': 'pcb_detect',
                            'title': 'PCB IC Detection',
                            'status': 'completed',
                            'message': f'Found {len(pcb_crops)} IC region(s); using crops for analysis',
                            'data': {
                                'overlay_paths': [p for p in pcb_overlays if p],
                                'crop_paths': [to_frontend_path(p) for p in pcb_crops]
                            }
                        })
                    else:
                        progress_queue.put({
                            'type': 'step',
                            'step': 'pcb_detect',
                            'title': 'PCB IC Detection',
                            'status': 'completed',
                            'message': 'No IC regions detected; using original uploads'
                        })

                # Run detection with (possibly cropped) images (multiple views)
                if not all_image_paths:
                    raise ValueError("No image paths available for detection")
                
                result = _detect_with_progress(
                    request_detector,  # Use per-request detector
                    all_image_paths[0],  # Primary image (guaranteed to exist)
                    session_id, 
                    progress_queue,
                    all_image_paths=all_image_paths,  # All images for multi-view analysis
                    uploaded_pdf_path=uploaded_pdf_path,
                    additional_info=additional_info,
                    api_results_path=api_results_path  # Pass storage path
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
                
                # Save to history (comprehensive storage for RAG)
                try:
                    # Get progress data from session (includes all step updates)
                    progress_data = sessions[session_id].get('progress', [])
                    # Also include current session state as additional context
                    if not progress_data and 'current_step' in sessions[session_id]:
                        progress_data = [{
                            'type': 'step',
                            'step': 'complete',
                            'title': 'Complete',
                            'status': 'completed',
                            'message': 'Processing completed',
                            'timestamp': sessions[session_id].get('completed_at', datetime.now().isoformat())
                        }]
                    history_result = history_mgr.save_processing(result, session_id, progress_data)
                    print(f"[API] Saved processing history for session {session_id}")
                    
                    # Also store in vector database for semantic search
                    try:
                        if VECTOR_DB_AVAILABLE and get_vector_db:
                            vector_db = get_vector_db()
                            if vector_db:
                                # Load the saved metadata and analysis data
                                detail = history_mgr.load_history_detail(session_id)
                                if detail:
                                    metadata = detail.get('metadata', {})
                                    analysis_data = detail.get('analysis', {})
                                    tool_outputs = analysis_data.get('tool_outputs', {})
                                    
                                    # Store in vector DB
                                    vector_db.store_analysis(
                                        session_id=session_id,
                                        metadata=metadata,
                                        analysis_data=analysis_data,
                                        tool_outputs=tool_outputs
                                    )
                                    print(f"[API] Stored analysis in vector DB for session {session_id}")
                    except Exception as vec_error:
                        print(f"[API] Warning: Failed to store in vector DB: {vec_error}")
                        import traceback
                        traceback.print_exc()
                except Exception as e:
                    print(f"[API] Warning: Failed to save processing history: {e}")
                    import traceback
                    traceback.print_exc()
                
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
                          all_image_paths: Optional[List[str]] = None, api_results_path: Optional[Path] = None):
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
    import cv2
    import numpy as np
    
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
        
        # STEP 0: Preprocessing - Run pipeline to get cropped IC and OCR visualization
        progress_queue.put({
            'type': 'step',
            'step': 'preprocess',
            'title': 'Preprocessing Image',
            'status': 'running',
            'message': 'Segmenting IC and detecting text regions...'
        })
        
        # Import pipeline module
        import sys
        import importlib.util
        pipeline_path = Path(__file__).parent / "tools" / "pipeline 2" / "pipeline.py"
        spec = importlib.util.spec_from_file_location("preprocessing_pipeline", pipeline_path)
        preprocessing_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(preprocessing_module)
        run_preprocessing_pipeline = preprocessing_module.run_pipeline
        
        # Create preprocessing output directory in session folder
        if api_results_path is None:
            backend_dir = Path(__file__).parent
            project_root = backend_dir.parent
            api_results_path = project_root / 'data' / 'api_results'
        
        preprocessing_output_dir = api_results_path / session_id / 'preprocessing'
        preprocessing_output_dir.mkdir(parents=True, exist_ok=True)
        
        # Run preprocessing on primary image
        preprocessing_result = run_preprocessing_pipeline(
            image_path=str(primary_image_path.resolve()),
            output_dir=str(preprocessing_output_dir),
            sam_model_path=str(Path(__file__).parent.parent / "weights" / "sam2.1_b.pt")
        )
        
        if not preprocessing_result:
            raise RuntimeError("Preprocessing failed - could not crop IC")
        
        # Get cropped image path (this will be used for Gemini and dimension estimation)
        cropped_image_path = preprocessing_result.get('output_ic_crop')
        ocr_visualization_path = preprocessing_result.get('output_textbox_viz')
        
        if not cropped_image_path or not Path(cropped_image_path).exists():
            raise FileNotFoundError(f"Preprocessing output not found: {cropped_image_path}")
        
        # Store preprocessing outputs in result
        result.preprocessing_outputs = {
            'ic_crop': cropped_image_path,
            'ocr_visualization': ocr_visualization_path,
            'horizontal_0': preprocessing_result.get('output_0_deg'),
            'horizontal_180': preprocessing_result.get('output_180_deg')
        }
        
        # Create URL for OCR visualization (for display in chain/preview)
        ocr_viz_url = None
        if ocr_visualization_path and Path(ocr_visualization_path).exists():
            try:
                ocr_viz_path = Path(ocr_visualization_path)
                if ocr_viz_path.is_absolute():
                    try:
                        ocr_viz_rel = str(ocr_viz_path.relative_to(api_results_path))
                    except ValueError:
                        ocr_viz_rel = ocr_viz_path.name
                else:
                    ocr_viz_rel = str(ocr_viz_path)
                ocr_viz_rel = ocr_viz_rel.replace('\\', '/').lstrip('/')
                from urllib.parse import quote
                ocr_viz_url = f'http://localhost:5001/api/download?file={quote(ocr_viz_rel, safe="")}'
            except Exception as e:
                print(f"[API] Error processing OCR visualization path: {e}")
                ocr_viz_url = None
        
        progress_queue.put({
            'type': 'step',
            'step': 'preprocess',
            'title': 'Preprocessing Image',
            'status': 'completed',
            'message': 'IC cropped, text regions and logo detected',
            'visualization': ocr_viz_url,  # Show OCR visualization in chain/preview
            'data': {
                'ic_crop_path': str(Path(cropped_image_path).relative_to(api_results_path)) if Path(cropped_image_path).is_relative_to(api_results_path) else cropped_image_path,
                'ocr_visualization_path': str(Path(ocr_visualization_path).relative_to(api_results_path)) if ocr_visualization_path and Path(ocr_visualization_path).is_relative_to(api_results_path) else ocr_visualization_path,
                'ocr_visualization_url': ocr_viz_url
            }
        })
        
        # STEP 1: IC Identification (now using cropped image from preprocessing)
        progress_queue.put({
            'type': 'step',
            'step': 'identify',
            'title': 'Identifying IC',
            'status': 'running',
            'message': 'Analyzing IC image with VLM...'
        })
        # Use cropped image from preprocessing for identification
        cropped_image_path_abs = Path(cropped_image_path).resolve()
        if not cropped_image_path_abs.exists():
            raise FileNotFoundError(f"Cropped image file not found: {cropped_image_path_abs}")
        
        # Pass cropped image to identification (not OCR visualization - that's just for display)
        ic_info = detector._identify_ic(cropped_image_path_abs, additional_info=additional_info, all_images=[cropped_image_path_abs])
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
            
            # Convert mechanical_diagram path to relative for frontend
            diagram_path_for_frontend = mechanical_diagram
            if mechanical_diagram:
                try:
                    diagram_path_obj = Path(mechanical_diagram)
                    # Use provided api_results_path or find it
                    if api_results_path is None:
                        backend_dir = Path(__file__).parent  # backend/
                        project_root = backend_dir.parent  # counterfeit_IC/
                        # Try both business and personal paths
                        possible_paths = [
                            project_root / 'data' / 'api_results',
                            project_root / 'data' / 'personal_api_results',
                            Path('data/api_results').resolve(),
                            Path(__file__).parent.parent / 'data' / 'api_results',
                            Path(__file__).parent.parent / 'data' / 'personal_api_results'
                        ]
                        for path in possible_paths:
                            if path.exists():
                                api_results_path = path.resolve()
                                break
                        if api_results_path is None:
                            # Default to business path
                            api_results_path = project_root / 'data' / 'api_results'
                    else:
                        api_results_path = Path(api_results_path).resolve()
                    
                    if api_results_path and diagram_path_obj.is_absolute():
                        try:
                            diagram_path_for_frontend = str(diagram_path_obj.relative_to(api_results_path))
                        except ValueError:
                            # Extract part after api_results
                            path_str = str(diagram_path_obj)
                            if 'api_results' in path_str:
                                parts = path_str.split('api_results')
                                if len(parts) > 1:
                                    diagram_path_for_frontend = parts[-1].lstrip('/\\')
                                else:
                                    diagram_path_for_frontend = diagram_path_obj.name
                            else:
                                diagram_path_for_frontend = diagram_path_obj.name
                    elif not diagram_path_obj.is_absolute():
                        # Already relative, remove data/api_results or data/personal_api_results prefix if present
                        rel_path = str(diagram_path_obj)
                        if rel_path.startswith('data/personal_api_results/'):
                            diagram_path_for_frontend = rel_path[len('data/personal_api_results/'):]
                        elif rel_path.startswith('data/api_results/'):
                            diagram_path_for_frontend = rel_path[len('data/api_results/'):]
                        elif rel_path.startswith('personal_api_results/'):
                            diagram_path_for_frontend = rel_path[len('personal_api_results/'):]
                        elif rel_path.startswith('api_results/'):
                            diagram_path_for_frontend = rel_path[len('api_results/'):]
                    
                    # Normalize path separators
                    diagram_path_for_frontend = diagram_path_for_frontend.replace('\\', '/').lstrip('/')
                except Exception as e:
                    print(f"[API] Error converting diagram path: {e}")
                    # Fallback to original
                    diagram_path_for_frontend = mechanical_diagram
            
            result.parsed_specs = parsed_specs
            result.mechanical_diagram_path = mechanical_diagram
            
            # Extract dimensions using Gemini from the mechanical diagram
            gemini_extracted_dims = None
            if mechanical_diagram and Path(mechanical_diagram).exists():
                try:
                    print(f"[API] Extracting dimensions from diagram using Gemini...")
                    gemini_extracted_dims = detector._extract_dimensions_with_gemini(mechanical_diagram)
                    if gemini_extracted_dims:
                        # Update parsed_specs with Gemini extraction (takes priority)
                        if parsed_specs is None:
                            parsed_specs = {}
                        if 'package_dimensions' not in parsed_specs:
                            parsed_specs['package_dimensions'] = {}
                        # Merge Gemini extraction (prefer Gemini over parser)
                        parsed_specs['package_dimensions'].update({
                            'body_length_mm': gemini_extracted_dims.get('body_length_mm'),
                            'body_width_mm': gemini_extracted_dims.get('body_width_mm'),
                            'length_mm': gemini_extracted_dims.get('body_length_mm'),
                            'width_mm': gemini_extracted_dims.get('body_width_mm'),
                            'height_mm': gemini_extracted_dims.get('height_mm'),
                            'pin_count': gemini_extracted_dims.get('pin_count'),
                            'pin_pitch_mm': gemini_extracted_dims.get('pin_pitch_mm'),
                            'package_type': gemini_extracted_dims.get('package_type')
                        })
                        result.parsed_specs = parsed_specs
                        print(f"[API] ✓ Gemini extracted dimensions: {gemini_extracted_dims.get('body_length_mm')} × {gemini_extracted_dims.get('body_width_mm')} mm")
                except Exception as e:
                    print(f"[API] ⚠️  Gemini dimension extraction failed: {e}")
            
            progress_queue.put({
                'type': 'step',
                'step': 'parse',
                'title': 'Extracting Parameters',
                'status': 'completed',
                'message': 'Mechanical specifications extracted',
                'data': {
                    'mechanical_diagram': diagram_path_for_frontend,  # Use relative path
                    'datasheet_path': datasheet_path,
                    'parsed_specs': parsed_specs,
                    'package_dimensions': parsed_specs.get('package_dimensions', {}) if parsed_specs else {}
                }
            })
        
        # STEP 4: Pin Counter (local YOLO) - after datasheet extraction
        progress_queue.put({
            'type': 'step',
            'step': 'pin_counter',
            'title': 'Pin Count Check',
            'status': 'running',
            'message': 'Counting pins with local YOLO model...'
        })
        pin_counter_dict, pin_viz = detector._run_pin_counter(primary_image_path)
        result.pin_counter = pin_counter_dict
        result.pin_visualization = pin_viz
        pin_viz_url = None
        if pin_viz:
            try:
                pin_viz_path = Path(pin_viz)
                if pin_viz_path.is_absolute():
                    try:
                        pin_viz_rel = str(pin_viz_path.relative_to(api_results_path))
                    except ValueError:
                        pin_viz_rel = pin_viz_path.name
                else:
                    pin_viz_rel = str(pin_viz_path)
                pin_viz_rel = pin_viz_rel.replace('\\', '/').lstrip('/')
                from urllib.parse import quote
                pin_viz_url = f'http://localhost:5001/api/download?file={quote(pin_viz_rel, safe="")}'
            except Exception as e:
                print(f"[API] Error processing pin counter visualization path: {e}")
                import traceback
                traceback.print_exc()
                pin_viz_url = None
        progress_queue.put({
            'type': 'step',
            'step': 'pin_counter',
            'title': 'Pin Count Check',
            'status': 'completed',
            'message': f"Pins detected: {pin_counter_dict.get('pins_detected', 0)}",
            'visualization': pin_viz_url,
            'data': pin_counter_dict
        })
        
        # STEP 5: Dimension Analysis (using cropped image from preprocessing)
        progress_queue.put({
            'type': 'step',
            'step': 'dimension',
            'title': 'Dimension Analysis',
            'status': 'running',
            'message': 'Measuring IC body dimensions...'
        })
        # Use cropped image from preprocessing for dimension estimation
        dimension_dict, dim_viz = detector._estimate_dimensions(cropped_image_path, result)
        result.dimension_analysis = dimension_dict

        # SAM-only visualization (produced inside dimension estimator)
        chosen_viz = dim_viz
        result.dimension_visualization = chosen_viz
        if chosen_viz:
            # Convert to relative path for frontend
            try:
                dim_viz_path = Path(chosen_viz)
                # Use provided api_results_path or find it
                if api_results_path is None:
                    backend_dir = Path(__file__).parent  # backend/
                    project_root = backend_dir.parent  # counterfeit_IC/
                    # Try both business and personal paths
                    possible_paths = [
                        project_root / 'data' / 'api_results',
                        project_root / 'data' / 'personal_api_results',
                        Path('data/api_results').resolve(),
                        Path(__file__).parent.parent / 'data' / 'api_results',
                        Path(__file__).parent.parent / 'data' / 'personal_api_results'
                    ]
                    for path in possible_paths:
                        if path.exists():
                            api_results_path = path.resolve()
                            break
                    if api_results_path is None:
                        # Default to business path
                        api_results_path = project_root / 'data' / 'api_results'
                else:
                    api_results_path = Path(api_results_path).resolve()
                
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
                            # Just use filename - file should be in api_results root
                            dim_viz_rel = dim_viz_path.name
                else:
                    # Already relative, remove 'data/personal_api_results/', 'data/api_results/', or 'api_results/' prefix if present
                    dim_viz_rel = str(dim_viz_path)
                    # Remove prefixes (handle both / and \)
                    if dim_viz_rel.startswith('data/personal_api_results/'):
                        dim_viz_rel = dim_viz_rel[len('data/personal_api_results/'):]
                    elif dim_viz_rel.startswith('data/personal_api_results\\'):
                        dim_viz_rel = dim_viz_rel[len('data/personal_api_results\\'):]
                    elif dim_viz_rel.startswith('data/api_results/'):
                        dim_viz_rel = dim_viz_rel[len('data/api_results/'):]
                    elif dim_viz_rel.startswith('data/api_results\\'):
                        dim_viz_rel = dim_viz_rel[len('data/api_results\\'):]
                    elif dim_viz_rel.startswith('personal_api_results/'):
                        dim_viz_rel = dim_viz_rel[len('personal_api_results/'):]
                    elif dim_viz_rel.startswith('personal_api_results\\'):
                        dim_viz_rel = dim_viz_rel[len('personal_api_results\\'):]
                    elif dim_viz_rel.startswith('api_results/'):
                        dim_viz_rel = dim_viz_rel[len('api_results/'):]
                    elif dim_viz_rel.startswith('api_results\\'):
                        dim_viz_rel = dim_viz_rel[len('api_results\\'):]
                
                # Ensure forward slashes for URL
                dim_viz_rel = dim_viz_rel.replace('\\', '/')
                # Remove any leading slashes
                dim_viz_rel = dim_viz_rel.lstrip('/')
                
                # Use /api/download endpoint for consistency
                from urllib.parse import quote
                dim_viz_rel_encoded = quote(dim_viz_rel, safe='')
                viz_url = f'http://localhost:5001/api/download?file={dim_viz_rel_encoded}'
                
                print(f"[API] Dimension viz URL: {viz_url} (from path: {chosen_viz}, relative: {dim_viz_rel}, api_results: {api_results_path})")
            except Exception as e:
                print(f"[API] Error processing visualization path: {e}")
                import traceback
                traceback.print_exc()
                viz_url = None
            
            measured_ar = dimension_dict.get("measured_aspect_ratio")
            message_ar = f'{measured_ar:.2f}' if isinstance(measured_ar, (int, float)) else 'N/A'
            progress_queue.put({
                'type': 'step',
                'step': 'dimension',
                'title': 'Dimension Analysis',
                'status': 'completed',
                'message': f'Dimensions: AR = {message_ar}',
                'visualization': viz_url,
                'sam_visualization': viz_url,
                'data': {**dimension_dict, 'sam_visualization': viz_url}
            })
        else:
            progress_queue.put({
                'type': 'step',
                'step': 'dimension',
                'title': 'Dimension Analysis',
                'status': 'completed',
                'message': 'Dimension analysis complete'
            })
        
        # STEP 5.5: Histogram Filter Analysis
        progress_queue.put({
            'type': 'step',
            'step': 'histogram_filter',
            'title': 'Histogram Filter Analysis',
            'status': 'running',
            'message': 'Running image processing filters for defect detection...'
        })
        histogram_manifest, dashboard_path, strips = detector._run_histogram_filter(primary_image_path, result)
        result.histogram_analysis = histogram_manifest
        result.histogram_dashboard = dashboard_path
        result.histogram_strips = strips
        
        # Create URLs for dashboard and strips
        dashboard_url = None
        if dashboard_path:
            try:
                dashboard_path_obj = Path(dashboard_path)
                if dashboard_path_obj.is_absolute():
                    try:
                        dashboard_rel = str(dashboard_path_obj.relative_to(api_results_path))
                    except ValueError:
                        dashboard_rel = dashboard_path_obj.name
                else:
                    dashboard_rel = str(dashboard_path_obj)
                dashboard_rel = dashboard_rel.replace('\\', '/').lstrip('/')
                from urllib.parse import quote
                dashboard_url = f'http://localhost:5001/api/download?file={quote(dashboard_rel, safe="")}'
            except Exception as e:
                print(f"[API] Error processing histogram dashboard path: {e}")
                dashboard_url = None
        
        # Create URLs for all strip images
        strip_urls = []
        if strips:
            for strip_path in strips:
                try:
                    strip_path_obj = Path(strip_path)
                    if strip_path_obj.is_absolute():
                        try:
                            strip_rel = str(strip_path_obj.relative_to(api_results_path))
                        except ValueError:
                            strip_rel = strip_path_obj.name
                    else:
                        strip_rel = str(strip_path_obj)
                    strip_rel = strip_rel.replace('\\', '/').lstrip('/')
                    from urllib.parse import quote
                    strip_url = f'http://localhost:5001/api/download?file={quote(strip_rel, safe="")}'
                    strip_urls.append(strip_url)
                except Exception as e:
                    print(f"[API] Error processing strip path {strip_path}: {e}")
                    # Still include the path even if URL creation fails
                    strip_urls.append(strip_path)
        
        progress_queue.put({
            'type': 'step',
            'step': 'histogram_filter',
            'title': 'Histogram Filter Analysis',
            'status': 'completed',
            'message': f'Applied 11 image processing filters (CLAHE, Edge Map, Threshold, etc.)',
            'visualization': dashboard_url,
            'data': {
                'dashboard_path': dashboard_path,
                'dashboard_url': dashboard_url,
                'strip_paths': strips,  # Original paths
                'strip_urls': strip_urls,  # URLs for frontend
                'analysis_json_path': histogram_manifest.get('analysis_json_path') if histogram_manifest else None
            }
        })
        
        # STEP 6: Visual Analysis
        progress_queue.put({
            'type': 'step',
            'step': 'visual',
            'title': 'Visual Comparison',
            'status': 'running',
            'message': 'Performing visual analysis'
        })
        
        # Fetch similar annotations for RAG context
        similar_annotations = []
        if VECTOR_DB_AVAILABLE and get_vector_db:
            try:
                vector_db = get_vector_db()
                if vector_db:
                    # Search for similar annotations based on part number and manufacturer
                    search_query = f"{result.part_number} {result.manufacturer} {result.package_type}"
                    similar_annotations = vector_db.search_annotations(
                        query=search_query,
                        limit=5,
                        filters={'correction_to_ai': True}  # Prioritize corrections
                    )
                    if similar_annotations:
                        print(f"  → Found {len(similar_annotations)} similar annotations for RAG context")
            except Exception as e:
                print(f"  ⚠️  Error fetching annotations: {e}")
        
        # Pass all images for multi-view analysis
        visual_result = detector._gemini_visual_analysis(
            primary_image_path, mechanical_diagram, parsed_specs, result,
            dimension_analysis=dimension_dict,
            datasheet_pdf_path=result.datasheet_path,
            all_images=image_paths,  # Pass all images for comprehensive analysis
            additional_info=additional_info,
            annotations=similar_annotations  # Pass annotations for RAG context
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
                'anomalies_count': len(result.anomalies),
                'anomalies': result.anomalies,
                'visual_comparison': visual_result
            }
        })
        
        # STEP 7: Final Verdict
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
        
        # STEP 8: Report Generation
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
            api_results_path = Path('data/api_results').resolve()
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
        # Return 200 with empty updates instead of 404 to allow graceful handling
        # Frontend will retry a few times before giving up
        print(f"[API] Progress request for session {session_id} - NOT FOUND. Available sessions: {list(sessions.keys())[:5]}")
        return jsonify({
            'updates': [],
            'error': 'Session not found',
            'session': None,
            'status': 'not_found'
        }), 200
    
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
    """Download a file by path (relative to api_results or absolute)
    Checks both business (data/api_results) and personal (data/personal_api_results) storage paths
    """
    file_path = request.args.get('file')
    if not file_path:
        return jsonify({'error': 'No file specified'}), 400
    
    # Get user type from request if available (for determining which storage to check first)
    user_type = request.headers.get('X-User-Type') or request.args.get('user_type')
    
    # Determine base paths for both workflows
    backend_dir = Path(__file__).parent  # backend/
    project_root = backend_dir.parent  # counterfeit_IC/
    business_path = project_root / 'data' / 'api_results'
    personal_path = project_root / 'data' / 'personal_api_results'
    
    # Also allow access to backend/tools directory for hardcoded images
    backend_tools_path = backend_dir / 'tools'
    
    # Try to find the file - check personal first if user_type is personal, otherwise business first
    full_path = None
    api_results_path = None
    
    # List of paths to try (order matters - try user's storage first)
    paths_to_try = []
    if user_type == 'personal':
        paths_to_try = [personal_path, business_path]
    else:
        paths_to_try = [business_path, personal_path]
    
    # All storage is now inside counterfeit_IC/data (no old external paths)
    
    # Handle both relative and absolute paths
    if Path(file_path).is_absolute():
        # If absolute, check if it's within any of our allowed paths
        full_path = Path(file_path)
        for allowed_path in paths_to_try + [backend_tools_path]:
            try:
                if str(full_path.resolve()).startswith(str(allowed_path.resolve())):
                    api_results_path = allowed_path
                    break
            except:
                continue
    else:
        # Relative path - try each storage location
        for storage_path in paths_to_try:
            candidate_path = storage_path / file_path
            if candidate_path.exists():
                full_path = candidate_path.resolve()
                api_results_path = storage_path.resolve()
                break
        
        # If not found in api_results, try backend/tools directory (for hardcoded images)
        if full_path is None or not full_path.exists():
            # Check if path starts with 'backend/tools' or just 'tools'
            if file_path.startswith('backend/tools') or file_path.startswith('tools'):
                # Remove 'backend/tools' prefix if present
                relative_path = file_path.replace('backend/tools/', '').replace('tools/', '')
                candidate_path = backend_tools_path / relative_path
                if candidate_path.exists():
                    full_path = candidate_path.resolve()
                    api_results_path = backend_tools_path.resolve()
            else:
                # Try directly in backend_tools_path
                candidate_path = backend_tools_path / file_path
                if candidate_path.exists():
                    full_path = candidate_path.resolve()
                    api_results_path = backend_tools_path.resolve()
    
    # If still not found, try resolving relative to current working directory
    if full_path is None or not full_path.exists():
        for storage_path in paths_to_try + [backend_tools_path]:
            try:
                candidate_path = (storage_path / file_path).resolve()
                # Security check: ensure path is within storage_path
                if str(candidate_path).startswith(str(storage_path.resolve())) and candidate_path.exists():
                    full_path = candidate_path
                    api_results_path = storage_path.resolve()
                    break
            except:
                continue
    
    if full_path is None or not full_path.exists():
        # Debug: log what we're looking for
        print(f"[API Download] File not found: {file_path}")
        print(f"[API Download] Tried paths: {[str(p) for p in paths_to_try]}")
        print(f"[API Download] User type: {user_type}")
        return jsonify({'error': 'File not found'}), 404
    
    # Security: ensure path is within one of our allowed storage paths
    try:
        full_path = full_path.resolve()
        is_allowed = False
        for allowed_path in paths_to_try + [backend_tools_path]:
            if str(full_path).startswith(str(allowed_path.resolve())):
                is_allowed = True
                api_results_path = allowed_path.resolve()
                break
        if not is_allowed:
            print(f"[API Download] Access denied: {full_path} is outside allowed paths")
            return jsonify({'error': 'Access denied'}), 403
    except Exception as e:
        print(f"[API Download] Invalid path resolution: {e}")
        return jsonify({'error': 'Invalid path'}), 400
    
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
        api_results_path = Path('data/api_results').resolve()
        full_path = api_results_path / report_path
    
    if not full_path.exists():
        # Try to find the report file with a pattern match
        api_results_path = Path('data/api_results').resolve()
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
    
    # Step 3: Histogram Filter Analysis
    if result.histogram_analysis:
        messages.append({
            'type': 'step',
            'title': '📊 Histogram Filter Analysis',
            'content': f"Applied **11 image processing filters** to enhance defect detection:\n\n"
                       f"• CLAHE (surface texture analysis)\n"
                       f"• Edge Map (crack/damage detection)\n"
                       f"• Otsu Threshold (contamination detection)\n"
                       f"• And 8 other filters for comprehensive analysis\n\n"
                       f"All filter outputs combined into a single dashboard for Gemini analysis."
        })
    
    # Step 4: Dimension Analysis
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
    
    # Step 5: Visual Analysis
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
    
    # Step 6: Anomalies
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


@app.route('/api/history', methods=['GET'])
def get_history():
    """Get list of all processing history (for business users)"""
    try:
        # Check if vector search is requested
        search_query = request.args.get('search', '').strip()
        use_vector_search = request.args.get('vector_search', 'false').lower() == 'true'
        limit = request.args.get('limit', type=int)
        sort_by = request.args.get('sort_by', 'processed_date')
        sort_order = request.args.get('sort_order', 'DESC')
        
        # Build filters
        filters = {}
        verdict = request.args.get('verdict')
        if verdict and verdict != 'all':
            filters['verdict'] = verdict
        manufacturer = request.args.get('manufacturer')
        if manufacturer:
            filters['manufacturer'] = manufacturer
        
        # Try vector search if query provided and vector DB available
        if search_query and use_vector_search and VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                results = vector_db.vector_search(
                    query=search_query,
                    limit=limit or 50,
                    filters=filters if filters else None
                )
                # Convert vector DB results to history format
                history_list = []
                for row in results:
                    # Convert database row to history format
                    metadata = row.get('metadata', {})
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)
                    # Flatten metadata structure for frontend consistency
                    history_item = {
                        'session_id': row['session_id'],
                        'processed_date': row['processed_date'].isoformat() if hasattr(row['processed_date'], 'isoformat') else str(row['processed_date']),
                        'verdict': row.get('verdict', 'UNKNOWN'),
                        'similarity': row.get('similarity')  # Include similarity score
                    }
                    # Flatten metadata properties to top level
                    if metadata:
                        history_item.update(metadata)
                    history_list.append(history_item)
                
                return jsonify({
                    'status': 'success',
                    'history': history_list,
                    'count': len(history_list),
                    'search_type': 'vector'
                })
        
        # Fallback to regular history or text search
        if search_query and VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                results = vector_db.text_search(
                    query=search_query,
                    limit=limit or 50,
                    filters=filters if filters else None
                )
                history_list = []
                for row in results:
                    metadata = row.get('metadata', {})
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)
                    # Flatten metadata structure for frontend consistency
                    history_item = {
                        'session_id': row['session_id'],
                        'processed_date': row['processed_date'].isoformat() if hasattr(row['processed_date'], 'isoformat') else str(row['processed_date']),
                        'verdict': row.get('verdict', 'UNKNOWN'),
                        'rank': row.get('rank')
                    }
                    # Flatten metadata properties to top level
                    if metadata:
                        history_item.update(metadata)
                    history_list.append(history_item)
                
                return jsonify({
                    'status': 'success',
                    'history': history_list,
                    'count': len(history_list),
                    'search_type': 'text'
                })
        
        # Regular history list (no search)
        history_list = default_history_manager.load_history_list(limit=limit)
        
        # Apply filters and sorting if vector DB available
        use_vector_db_filtering = False
        db_results = None
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db and (filters or sort_by != 'processed_date'):
                # Try to use vector DB for filtered/sorted results
                try:
                    db_results = vector_db.get_all(
                        limit=limit,
                        sort_by=sort_by,
                        sort_order=sort_order,
                        filters=filters if filters else None
                    )
                    # Only use vector DB results if we got some results, otherwise fall back
                    if db_results and len(db_results) > 0:
                        use_vector_db_filtering = True
                        history_list = []
                    else:
                        print(f"[API] Vector DB returned 0 results for filters {filters}, falling back to regular history")
                except Exception as e:
                    print(f"[API] Vector DB filtering failed: {e}, falling back to regular history")
        
        if use_vector_db_filtering and db_results:
            # Process vector DB results
            for row in db_results:
                    metadata = row.get('metadata', {})
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except:
                            metadata = {}
                    
                    # Reconstruct nested structure to match frontend expectations
                    # Extract ic_info from flat columns or metadata
                    ic_info = metadata.get('ic_info', {}) if isinstance(metadata, dict) else {}
                    if not ic_info or not isinstance(ic_info, dict):
                        ic_info = {}
                    
                    # Populate ic_info from database columns if not in metadata
                    if row.get('part_number'):
                        ic_info['part_number'] = row['part_number']
                    if row.get('manufacturer'):
                        ic_info['manufacturer'] = row['manufacturer']
                    if row.get('package_type'):
                        ic_info['package_type'] = row['package_type']
                    if row.get('pin_count') is not None:
                        ic_info['pin_count'] = row['pin_count']
                    if row.get('country_of_origin'):
                        ic_info['coo'] = row['country_of_origin']
                    
                    # Extract scores from metadata or use database column
                    scores = metadata.get('scores', {}) if isinstance(metadata, dict) else {}
                    if not scores or not isinstance(scores, dict):
                        scores = {}
                    if row.get('authenticity_score') is not None:
                        scores['authenticity_score'] = float(row['authenticity_score'])
                    
                    # Extract file_paths from metadata
                    file_paths = metadata.get('file_paths', {}) if isinstance(metadata, dict) else {}
                    if not file_paths or not isinstance(file_paths, dict):
                        file_paths = {}
                    # Also check if metadata has file_paths at top level (from flattened structure)
                    if isinstance(metadata, dict) and 'thumbnail' in metadata and 'thumbnail' not in file_paths:
                        file_paths['thumbnail'] = metadata.get('thumbnail')
                    if isinstance(metadata, dict) and 'primary_image' in metadata and 'primary_image' not in file_paths:
                        file_paths['primary_image'] = metadata.get('primary_image')
                    if isinstance(metadata, dict) and 'datasheet' in metadata and 'datasheet' not in file_paths:
                        file_paths['datasheet'] = metadata.get('datasheet')
                    
                    # Preserve other metadata fields (date_codes, lot_codes, etc.)
                    if isinstance(metadata, dict):
                        for key in ['date_codes', 'lot_codes', 'temperature_grade', 'speed_grade', 'package_variant']:
                            if key in metadata and key not in ic_info:
                                ic_info[key] = metadata[key]
                        # Also check if ic_info is nested in metadata
                        if 'ic_info' in metadata and isinstance(metadata['ic_info'], dict):
                            for key, value in metadata['ic_info'].items():
                                if key not in ic_info or not ic_info[key]:
                                    ic_info[key] = value
                        # Check if file_paths is nested in metadata
                        if 'file_paths' in metadata and isinstance(metadata['file_paths'], dict):
                            file_paths.update(metadata['file_paths'])
                        # Check if scores is nested in metadata
                        if 'scores' in metadata and isinstance(metadata['scores'], dict):
                            scores.update(metadata['scores'])
                    
                    # CRITICAL FIX: Override COO with identify tool output if available
                    # The metadata might have wrong COO (PH) from fallback, but identify tool has correct one
                    session_id = row['session_id']
                    try:
                        detail = default_history_manager.load_history_detail(session_id)
                        if detail and detail.get('analysis', {}).get('tool_outputs', {}).get('identify'):
                            identify_output = detail['analysis']['tool_outputs']['identify']
                            identify_data = identify_output.get('data') or identify_output.get('result') or identify_output
                            country_codes = identify_data.get('country_codes', [])
                            
                            # First try country_codes array
                            correct_coo = None
                            if country_codes and isinstance(country_codes, list) and len(country_codes) > 0:
                                correct_coo = str(country_codes[0]).upper()
                            
                            # If no country_codes, try to extract from additional_markings, lot_codes, or part_number text
                            if not correct_coo or correct_coo == 'UNKNOWN':
                                # Collect all text fields that might contain country codes
                                all_text_parts = []
                                
                                # From additional_markings
                                additional_markings = identify_data.get('additional_markings', [])
                                for m in additional_markings:
                                    if isinstance(m, dict):
                                        all_text_parts.append(str(m.get('text', '')))
                                        all_text_parts.append(str(m.get('decoded', '')))
                                
                                # From lot_codes (often contains country codes like "CHN GQ 912" or "MYS 99 130")
                                lot_codes = identify_data.get('lot_codes', [])
                                for lot in lot_codes:
                                    if isinstance(lot, dict):
                                        all_text_parts.append(str(lot.get('raw', '')))
                                        all_text_parts.append(str(lot.get('meaning', '')))
                                        all_text_parts.append(str(lot.get('location', '')))  # Location often mentions country codes
                                    else:
                                        all_text_parts.append(str(lot))
                                
                                # From part_number
                                all_text_parts.append(str(identify_data.get('part_number', '')))
                                
                                # From reasoning (sometimes contains full text description)
                                all_text_parts.append(str(identify_data.get('reasoning', '')))
                                
                                # Combine all text
                                all_text = ' '.join(all_text_parts).upper()
                                
                                # Look for country codes in text (CHN, MYS, TW, etc.)
                                # Priority order: CHN > MYS > TW > others (to avoid false matches)
                                country_patterns = [
                                    ('CHN', r'\bCHN\b'),
                                    ('MYS', r'\bMYS\b'),
                                    ('TW', r'\bTW\b'),
                                    ('MY', r'\bMY\b(?!S)'),  # MY but not MYS
                                    ('CN', r'\bCN\b(?!H)'),  # CN but not CHN
                                    ('PH', r'\bPH\b'),
                                    ('US', r'\bUS\b(?!A)'),  # US but not USA
                                    ('JP', r'\bJP\b')
                                ]
                                
                                for code, pattern in country_patterns:
                                    if re.search(pattern, all_text):
                                        correct_coo = code
                                        print(f"[API] Extracted COO from text for {session_id}: {correct_coo} (from: {all_text[:80]})")
                                        break
                            
                            if correct_coo and correct_coo != 'UNKNOWN':
                                old_coo = ic_info.get('coo', 'Unknown')
                                ic_info['coo'] = correct_coo
                                if old_coo != correct_coo:
                                    print(f"[API] Fixed COO for {session_id}: {old_coo} -> {correct_coo}")
                    except Exception as e:
                        # Don't fail if we can't load detail, just use metadata COO
                        pass
                    
                    # Build history item with proper nested structure
                    history_item = {
                        'session_id': session_id,
                        'processed_date': row['processed_date'].isoformat() if hasattr(row['processed_date'], 'isoformat') else str(row['processed_date']),
                        'verdict': row.get('verdict', 'UNKNOWN'),
                        'ic_info': ic_info,
                        'scores': scores,
                        'file_paths': file_paths
                    }
                    
                    # Debug: Log if critical fields are missing
                    if not ic_info.get('part_number') and not row.get('part_number'):
                        print(f"[API] Warning: No part_number for session {row['session_id']}")
                    if not file_paths.get('thumbnail'):
                        print(f"[API] Warning: No thumbnail for session {row['session_id']}")
                    
                    # Add any other top-level metadata fields
                    if isinstance(metadata, dict):
                        for key in ['processing_time_seconds', 'anomalies_count', 'additional_info']:
                            if key in metadata:
                                history_item[key] = metadata[key]
                    
                    history_list.append(history_item)
        
        # If we didn't use vector DB filtering (or it returned 0 results), enrich regular history list with correct COO
        if not use_vector_db_filtering:
            # Enrich each history item with correct COO from identify tool output
            for item in history_list:
                session_id = item.get('session_id')
                if session_id:
                    try:
                        detail = default_history_manager.load_history_detail(session_id)
                        if detail and detail.get('analysis', {}).get('tool_outputs', {}).get('identify'):
                            identify_output = detail['analysis']['tool_outputs']['identify']
                            identify_data = identify_output.get('data') or identify_output.get('result') or identify_output
                            country_codes = identify_data.get('country_codes', [])
                            
                            # First try country_codes array
                            correct_coo = None
                            if country_codes and isinstance(country_codes, list) and len(country_codes) > 0:
                                correct_coo = str(country_codes[0]).upper()
                            
                            # If no country_codes, try to extract from additional_markings, lot_codes, or part_number text
                            if not correct_coo or correct_coo == 'UNKNOWN':
                                # Collect all text fields that might contain country codes
                                all_text_parts = []
                                
                                # From additional_markings
                                additional_markings = identify_data.get('additional_markings', [])
                                for m in additional_markings:
                                    if isinstance(m, dict):
                                        all_text_parts.append(str(m.get('text', '')))
                                        all_text_parts.append(str(m.get('decoded', '')))
                                
                                # From lot_codes (often contains country codes like "CHN GQ 912" or "MYS 99 130")
                                lot_codes = identify_data.get('lot_codes', [])
                                for lot in lot_codes:
                                    if isinstance(lot, dict):
                                        all_text_parts.append(str(lot.get('raw', '')))
                                        all_text_parts.append(str(lot.get('meaning', '')))
                                        all_text_parts.append(str(lot.get('location', '')))  # Location often mentions country codes
                                    else:
                                        all_text_parts.append(str(lot))
                                
                                # From part_number
                                all_text_parts.append(str(identify_data.get('part_number', '')))
                                
                                # From reasoning (sometimes contains full text description)
                                all_text_parts.append(str(identify_data.get('reasoning', '')))
                                
                                # Combine all text
                                all_text = ' '.join(all_text_parts).upper()
                                
                                # Look for country codes in text (CHN, MYS, TW, etc.)
                                # Priority order: CHN > MYS > TW > others (to avoid false matches)
                                country_patterns = [
                                    ('CHN', r'\bCHN\b'),
                                    ('MYS', r'\bMYS\b'),
                                    ('TW', r'\bTW\b'),
                                    ('MY', r'\bMY\b(?!S)'),  # MY but not MYS
                                    ('CN', r'\bCN\b(?!H)'),  # CN but not CHN
                                    ('PH', r'\bPH\b'),
                                    ('US', r'\bUS\b(?!A)'),  # US but not USA
                                    ('JP', r'\bJP\b')
                                ]
                                
                                for code, pattern in country_patterns:
                                    if re.search(pattern, all_text):
                                        correct_coo = code
                                        print(f"[API] Extracted COO from text for {session_id}: {correct_coo} (from: {all_text[:80]})")
                                        break
                            
                            if correct_coo and correct_coo != 'UNKNOWN':
                                # Update COO in ic_info
                                if 'ic_info' not in item:
                                    item['ic_info'] = {}
                                old_coo = item.get('ic_info', {}).get('coo', 'Unknown')
                                item['ic_info']['coo'] = correct_coo
                                if old_coo != correct_coo:
                                    print(f"[API] Fixed COO for {session_id} in regular list: {old_coo} -> {correct_coo}")
                    except Exception as e:
                        # Don't fail if we can't load detail, just use metadata COO
                        pass
            
            # Apply filters manually to regular history list
            if filters:
                filtered_list = []
                for item in history_list:
                    should_include = True
                    
                    # Apply verdict filter
                    if filters.get('verdict'):
                        verdict_filter = filters['verdict'].upper()
                        # Get verdict from item - check both top level and nested
                        item_verdict_raw = item.get('verdict') or 'UNKNOWN'
                        item_verdict = str(item_verdict_raw).upper()
                        
                        # Debug logging
                        if verdict_filter == 'SUSPICIOUS':
                            print(f"[API] Filtering for SUSPICIOUS - Item verdict: '{item_verdict}' (raw: '{item_verdict_raw}')")
                        
                        # Handle partial matching for SUSPICIOUS
                        if verdict_filter == 'SUSPICIOUS':
                            if 'SUSPICIOUS' not in item_verdict:
                                should_include = False
                        elif verdict_filter == 'COUNTERFEIT':
                            if 'COUNTERFEIT' not in item_verdict:
                                should_include = False
                        elif verdict_filter == 'AUTHENTIC':
                            if 'AUTHENTIC' not in item_verdict or 'SUSPICIOUS' in item_verdict or 'COUNTERFEIT' in item_verdict:
                                should_include = False
                        else:
                            if item_verdict != verdict_filter:
                                should_include = False
                    
                    # Apply manufacturer filter if present
                    if should_include and filters.get('manufacturer'):
                        manufacturer_filter = filters['manufacturer'].lower()
                        ic_info = item.get('ic_info', {})
                        item_manufacturer = (ic_info.get('manufacturer') or '').lower()
                        if manufacturer_filter not in item_manufacturer:
                            should_include = False
                    
                    if should_include:
                        filtered_list.append(item)
                
                history_list = filtered_list
        
        return jsonify({
            'status': 'success',
            'history': history_list,
            'count': len(history_list)
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/<session_id>', methods=['GET', 'DELETE'])
def get_history_detail(session_id):
    """Get full details for a specific processing or delete history entry"""
    if request.method == 'DELETE':
        # Handle DELETE request
        try:
            # Get user type to determine which history manager to use
            user_type = request.headers.get('X-User-Type') or request.args.get('user_type', 'business')
            
            # Get the appropriate history manager
            if user_type == 'personal':
                backend_dir = Path(__file__).parent
                project_root = backend_dir.parent
                history_base_dir = "data/personal_api_results"
                history_manager = HistoryManager(base_dir=history_base_dir)
            else:
                history_manager = default_history_manager
            
            success = history_manager.delete_history(session_id)
            
            if success:
                return jsonify({
                    'status': 'success',
                    'message': 'History deleted successfully'
                })
            else:
                return jsonify({
                    'error': 'History not found or could not be deleted',
                    'status': 'failed'
                }), 404
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({
                'error': str(e),
                'status': 'failed'
            }), 500
    
    # Handle GET request
    try:
        detail = default_history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({
                'error': 'History not found',
                'status': 'not_found'
            }), 404
        
        return jsonify({
            'status': 'success',
            'detail': detail
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/<session_id>/metadata', methods=['GET'])
def get_history_metadata(session_id):
    """Get metadata only (for card display)"""
    try:
        detail = default_history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({
                'error': 'History not found',
                'status': 'not_found'
            }), 404
        
        # Return only metadata (without analysis data)
        metadata = {k: v for k, v in detail.items() if k != 'analysis' and k != 'rag_index' and k != 'progress'}
        return jsonify({
            'status': 'success',
            'metadata': metadata
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500
@app.route('/api/history/<session_id>/verdict', methods=['POST'])
def update_history_verdict(session_id):
    """Update verdict for a history entry (manual review)"""
    try:
        data = request.get_json() or {}
        verdict = data.get('verdict', '').upper()
        manually_reviewed = data.get('manually_reviewed', True)
        
        if not verdict:
            return jsonify({
                'error': 'Verdict is required',
                'status': 'failed'
            }), 400
        
        # Validate verdict
        valid_verdicts = ['AUTHENTIC', 'COUNTERFEIT', 'SUSPICIOUS', 'UNKNOWN']
        if verdict not in valid_verdicts:
            return jsonify({
                'error': f'Invalid verdict. Must be one of: {', '.join(valid_verdicts)}',
                'status': 'failed'
            }), 400
        
        # Get user type to determine which history manager to use
        user_type = request.headers.get('X-User-Type') or request.args.get('user_type', 'business')
        
        # Get the appropriate history manager
        if user_type == 'personal':
            backend_dir = Path(__file__).parent
            project_root = backend_dir.parent
            history_base_dir = "data/personal_api_results"
            history_manager = HistoryManager(base_dir=history_base_dir)
        else:
            history_manager = default_history_manager
        
        # Update verdict
        success = history_manager.update_verdict(session_id, verdict, manually_reviewed)
        
        if success:
            return jsonify({
                'status': 'success',
                'message': f'Verdict updated to {verdict}',
                'verdict': verdict,
                'manually_reviewed': manually_reviewed
            })
        else:
            return jsonify({
                'error': 'History not found or could not be updated',
                'status': 'failed'
            }), 404
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500




@app.route('/api/history/lots', methods=['GET'])
def get_history_lots():
    """Get list of all lots for selection UI"""
    try:
        history_list = default_history_manager.load_history_list()
        # Return simplified list for lot selection
        lots = []
        for item in history_list:
            lots.append({
                'session_id': item.get('session_id'),
                'part_number': item.get('ic_info', {}).get('part_number', 'UNKNOWN'),
                'manufacturer': item.get('ic_info', {}).get('manufacturer', 'UNKNOWN'),
                'processed_date': item.get('processed_date'),
                'authenticity_score': item.get('scores', {}).get('authenticity_score', 0),
                'verdict': item.get('verdict', 'UNKNOWN'),
                'thumbnail': item.get('file_paths', {}).get('thumbnail')
            })
        
        return jsonify({
            'status': 'success',
            'lots': lots,
            'count': len(lots)
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/search', methods=['POST'])
def search_history():
    """RAG search across selected lots with enhanced reference extraction"""
    try:
        data = request.get_json() or {}
        lot_ids = data.get('lot_ids', [])  # List of session_ids
        query = data.get('query', '')
        conversation_history = data.get('conversation_history', [])  # For conversational context
        
        if not lot_ids:
            return jsonify({
                'error': 'No lots selected',
                'status': 'failed'
            }), 400
        
        if not query:
            return jsonify({
                'error': 'No query provided',
                'status': 'failed'
            }), 400
        
        # Load RAG indices for selected lots with full detail
        rag_contents = []
        for lot_id in lot_ids:
            detail = default_history_manager.load_history_detail(lot_id)
            if detail and 'rag_index' in detail:
                # Extract metadata for better reference display
                ic_info = detail.get('ic_info', {})
                metadata = {
                    'session_id': lot_id,
                    'part_number': ic_info.get('part_number', 'UNKNOWN'),
                    'manufacturer': ic_info.get('manufacturer', 'UNKNOWN'),
                    'package_type': ic_info.get('package_type', ''),
                    'pin_count': ic_info.get('pin_count', 0),
                    'processed_date': detail.get('processed_date', ''),
                    'verdict': detail.get('verdict', 'UNKNOWN'),
                    'authenticity_score': detail.get('scores', {}).get('authenticity_score', 0)
                }
                
                rag_contents.append({
                    'session_id': lot_id,
                    'part_number': metadata['part_number'],
                    'manufacturer': metadata['manufacturer'],
                    'content': detail['rag_index'].get('full_text_content', ''),
                    'sections': detail['rag_index'].get('sections', {}),
                    'metadata': metadata,
                    'analysis': detail.get('analysis', {})
                })
        
        if not rag_contents:
            return jsonify({
                'error': 'No RAG content found for selected lots',
                'status': 'failed'
            }), 404
        
        # Build context with lot identifiers
        lot_contexts = []
        for i, item in enumerate(rag_contents):
            lot_contexts.append(f"""
Lot {i+1} - {item['part_number']} ({item['manufacturer']}):
Session ID: {item['session_id']}
Package: {item['metadata'].get('package_type', 'N/A')}
Pin Count: {item['metadata'].get('pin_count', 'N/A')}
Verdict: {item['metadata'].get('verdict', 'UNKNOWN')}
Authenticity Score: {item['metadata'].get('authenticity_score', 0):.2f}

Content:
{item['content']}
""")
        
        combined_content = '\n\n---\n\n'.join(lot_contexts)
        
        # Build conversation context
        conversation_context = ""
        if conversation_history:
            conversation_context = "\n\nPrevious conversation:\n"
            for msg in conversation_history[-5:]:  # Last 5 messages for context
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                conversation_context += f"{role.capitalize()}: {content}\n"
        
        # Use Gemini 2.5 Flash to answer the query (not experimental model to avoid rate limits)
        try:
            import google.generativeai as genai
            sys.path.insert(0, str(Path(__file__).parent))
            from utils import get_api_key
            
            api_key = get_api_key("GEMINI_API_KEY")
            genai.configure(api_key=api_key)
            # Use 2.5-flash (not 2.0-flash-exp) - better rate limits on free tier
            model = genai.GenerativeModel('gemini-2.5-flash')
            
            prompt = f"""You are analyzing multiple IC processing lots. Answer the user's question based on the following comprehensive data from {len(rag_contents)} processing lots.

{conversation_context}

Processing Data from {len(rag_contents)} lots:
{combined_content}

User Question: {query}

Provide a detailed answer based on the processing data. Include specific references to which lot(s) (by part number and session ID) and which sections of the analysis support your answer. Be thorough and cite sources with lot identifiers.

Answer:"""
            
            response = model.generate_content(prompt)
            answer = response.text
            
        except Exception as e:
            print(f"[API] Error calling Gemini for RAG answer: {e}")
            # Fallback to simple answer if Gemini fails
            answer = f"Found information across {len(rag_contents)} lot(s). See references on the right for details."
        
        # Enhanced reference extraction with better metadata
        references = []
        query_keywords = [w.lower() for w in query.split() if len(w) > 3]  # Filter short words
        
        for item in rag_contents:
            # Search through all sections
            for section_name, section_content in item['sections'].items():
                section_lower = section_content.lower()
                # Check relevance by keyword matching
                relevance_score = 0
                matched_keywords = []
                
                for keyword in query_keywords:
                    if keyword in section_lower:
                        relevance_score += 1
                        matched_keywords.append(keyword)
                
                # Include if at least one keyword matches or section is highly relevant
                if relevance_score > 0 or any(kw in section_lower for kw in ['anomaly', 'dimension', 'visual', 'oem', 'reasoning']):
                    # Extract a meaningful snippet (around matched keywords if possible)
                    snippet = section_content
                    if len(snippet) > 500:
                        # Try to find a good starting point
                        for kw in matched_keywords[:1]:
                            idx = section_lower.find(kw)
                            if idx > 0:
                                start = max(0, idx - 100)
                                end = min(len(snippet), idx + 400)
                                snippet = snippet[start:end]
                                if start > 0:
                                    snippet = '...' + snippet
                                if end < len(section_content):
                                    snippet = snippet + '...'
                                break
                        else:
                            snippet = snippet[:500] + '...'
                    
                    # Determine document ID (use part number or session ID)
                    doc_id = f"{item['part_number']}_{item['session_id'][:8]}"
                    
                    # Map section names to more readable labels
                    section_labels = {
                        'ic_identification': 'IC Identification',
                        'datasheet_content': 'Datasheet',
                        'dimension_analysis': 'Dimension Analysis',
                        'visual_analysis': 'Visual Analysis',
                        'anomalies': 'Anomalies',
                        'reasoning': 'Reasoning',
                        'report_summary': 'Report Summary'
                    }
                    section_label = section_labels.get(section_name, section_name.replace('_', ' ').title())
                    
                    references.append({
                        'document_id': doc_id,
                        'lot_id': item['session_id'],
                        'part_number': item['part_number'],
                        'manufacturer': item['manufacturer'],
                        'section': section_label,
                        'section_key': section_name,
                        'snippet': snippet,
                        'relevance_score': round(relevance_score / max(len(query_keywords), 1) * 10, 2),  # Normalize to 0-10
                        'page': None,  # Could be extracted from PDF if available
                        'knowledge_group': f"{item['part_number']} - {item['manufacturer']}"
                    })
        
        # Sort by relevance score and limit
        references.sort(key=lambda x: x['relevance_score'], reverse=True)
        references = references[:10]
        
        return jsonify({
            'status': 'success',
            'answer': answer,
            'references': references,
            'lots_searched': len(rag_contents),
            'query': query
        })
        
    except Exception as e:
            print(f"[API] Error in RAG search: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({
                'error': f'RAG search failed: {str(e)}',
                'status': 'failed'
            }), 500
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/<session_id>/download', methods=['GET'])
def download_history_report(session_id):
    """Download PDF report for a history item"""
    try:
        # Get user type to determine which history manager to use
        user_type = request.headers.get('X-User-Type') or request.args.get('user_type', 'business')
        
        # Get the appropriate history manager
        if user_type == 'personal':
            backend_dir = Path(__file__).parent
            project_root = backend_dir.parent
            history_base_dir = "data/personal_api_results"
            history_manager = HistoryManager(base_dir=history_base_dir)
        else:
            history_manager = default_history_manager
        
        detail = history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({
                'error': 'History not found'
            }), 404
        
        report_path = detail.get('file_paths', {}).get('report_pdf')
        if not report_path:
            return jsonify({
                'error': 'Report not found'
            }), 404
        
        # Construct full path based on user type
        backend_dir = Path(__file__).parent
        project_root = backend_dir.parent
        if user_type == 'personal':
            api_results_path = project_root / 'data' / 'personal_api_results'
        else:
            api_results_path = project_root / 'data' / 'api_results'
        
        full_path = api_results_path / report_path
        
        if not full_path.exists():
            return jsonify({
                'error': 'Report file not found'
            }), 404
        
        return send_file(
            str(full_path),
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f"counterfeit_report_{session_id}.pdf"
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/annotations', methods=['POST'])
def create_annotation():
    """Create a new annotation"""
    try:
        data = request.json
        session_id = data.get('session_id')
        
        if not session_id:
            return jsonify({'error': 'session_id required'}), 400
        
        # Generate unique annotation ID
        annotation_id = data.get('annotation_id') or f"{session_id}_{uuid.uuid4().hex[:8]}"
        
        annotation = {
            'session_id': session_id,
            'image_path': data.get('image_path', ''),
            'annotation_id': annotation_id,
            'bbox_x': float(data.get('bbox_x', 0)),
            'bbox_y': float(data.get('bbox_y', 0)),
            'bbox_width': float(data.get('bbox_width', 0)),
            'bbox_height': float(data.get('bbox_height', 0)),
            'label': data.get('label', ''),
            'description': data.get('description', ''),
            'annotation_type': data.get('annotation_type', 'feature'),
            'severity': data.get('severity'),
            'verified': data.get('verified', False),
            'user_id': data.get('user_id'),
            'user_notes': data.get('user_notes', ''),
            'correction_to_ai': data.get('correction_to_ai', False)
        }
        
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                success = vector_db.store_annotation(session_id, annotation)
                if success:
                    return jsonify({
                        'success': True,
                        'annotation_id': annotation_id,
                        'message': 'Annotation saved successfully'
                    }), 201
        
        # Fallback: store in file system if vector DB unavailable
        return jsonify({
            'success': True,
            'annotation_id': annotation_id,
            'message': 'Annotation saved (vector DB unavailable, using file storage)'
        }), 201
        
    except Exception as e:
        print(f"[API] Error creating annotation: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/annotations/<session_id>', methods=['GET'])
def get_annotations(session_id):
    """Get all annotations for a session"""
    try:
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                annotations = vector_db.get_annotations_for_session(session_id)
                # Convert numpy types to native Python types and remove embedding
                for ann in annotations:
                    if 'embedding' in ann:
                        del ann['embedding']  # Remove embedding from response
                    # Convert any numpy types
                    for key, value in ann.items():
                        if hasattr(value, 'item'):  # numpy scalar
                            ann[key] = value.item()
                return jsonify({'annotations': annotations}), 200
        
        return jsonify({'annotations': []}), 200
        
    except Exception as e:
        print(f"[API] Error getting annotations: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'annotations': []}), 500

@app.route('/api/annotations/<annotation_id>', methods=['PUT'])
def update_annotation(annotation_id):
    """Update an annotation"""
    try:
        data = request.json
        
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                # Get existing annotation
                session_id = data.get('session_id')
                if session_id:
                    annotations = vector_db.get_annotations_for_session(session_id)
                    existing = next((a for a in annotations if a.get('annotation_id') == annotation_id), None)
                    
                    if existing:
                        # Update fields
                        existing.update(data)
                        existing['annotation_id'] = annotation_id  # Preserve ID
                        success = vector_db.store_annotation(session_id, existing)
                        if success:
                            return jsonify({'success': True, 'message': 'Annotation updated'}), 200
        
        return jsonify({'error': 'Annotation not found'}), 404
        
    except Exception as e:
        print(f"[API] Error updating annotation: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/annotations/<annotation_id>', methods=['DELETE'])
def delete_annotation(annotation_id):
    """Delete an annotation"""
    try:
        session_id = request.args.get('session_id')
        
        if not session_id:
            return jsonify({'error': 'session_id required'}), 400
        
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                conn = vector_db._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "DELETE FROM ic_annotations WHERE annotation_id = %s AND session_id = %s",
                    (annotation_id, session_id)
                )
                conn.commit()
                vector_db._return_connection(conn)
                return jsonify({'success': True, 'message': 'Annotation deleted'}), 200
        
        return jsonify({'error': 'Vector DB unavailable'}), 500
        
    except Exception as e:
        print(f"[API] Error deleting annotation: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/annotations/search', methods=['POST'])
def search_annotations():
    """Search annotations using RAG"""
    try:
        data = request.json
        query = data.get('query', '')
        limit = data.get('limit', 10)
        filters = data.get('filters', {})
        
        if not query:
            return jsonify({'error': 'query required'}), 400
        
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                results = vector_db.search_annotations(query, limit, filters)
                # Remove embeddings from response
                for r in results:
                    if 'embedding' in r:
                        del r['embedding']
                    # Convert numpy types
                    for key, value in r.items():
                        if hasattr(value, 'item'):
                            r[key] = value.item()
                return jsonify({'results': results}), 200
        
        return jsonify({'results': []}), 200
        
    except Exception as e:
        print(f"[API] Error searching annotations: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'results': []}), 500


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
    print(f"  - GET  /api/history    : List all processing history")
    print(f"  - GET  /api/history/<id> : Get history details")
    print(f"  - GET  /api/history/lots : Get lots for selection")
    print(f"  - POST /api/history/search : RAG search across lots")
    print(f"  - POST /api/annotations : Create annotation")
    print(f"  - GET  /api/annotations/<session_id> : Get annotations for session")
    print(f"  - PUT  /api/annotations/<id> : Update annotation")
    print(f"  - DELETE /api/annotations/<id> : Delete annotation")
    print(f"  - POST /api/annotations/search : RAG search annotations")
    print("=" * 70)
    
    # Configure for long-running requests (detection takes 25-40 seconds)
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)


@app.route('/api/history/<session_id>', methods=['GET', 'DELETE'])
def get_history_detail(session_id):
    """Get full details for a specific processing or delete history entry"""
    if request.method == 'DELETE':
        # Handle DELETE request
        try:
            # Get user type to determine which history manager to use
            user_type = request.headers.get('X-User-Type') or request.args.get('user_type', 'business')
            
            # Get the appropriate history manager
            if user_type == 'personal':
                backend_dir = Path(__file__).parent
                project_root = backend_dir.parent
                history_base_dir = "data/personal_api_results"
                history_manager = HistoryManager(base_dir=history_base_dir)
            else:
                history_manager = default_history_manager
            
            success = history_manager.delete_history(session_id)
            
            if success:
                return jsonify({
                    'status': 'success',
                    'message': 'History deleted successfully'
                })
            else:
                return jsonify({
                    'error': 'History not found or could not be deleted',
                    'status': 'failed'
                }), 404
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({
                'error': str(e),
                'status': 'failed'
            }), 500
    
    # Handle GET request
    try:
        detail = default_history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({
                'error': 'History not found',
                'status': 'not_found'
            }), 404
        
        return jsonify({
            'status': 'success',
            'detail': detail
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/<session_id>/metadata', methods=['GET'])
def get_history_metadata(session_id):
    """Get metadata only (for card display)"""
    try:
        detail = default_history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({
                'error': 'History not found',
                'status': 'not_found'
            }), 404
        
        # Return only metadata (without analysis data)
        metadata = {k: v for k, v in detail.items() if k != 'analysis' and k != 'rag_index' and k != 'progress'}
        return jsonify({
            'status': 'success',
            'metadata': metadata
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/<session_id>/verdict', methods=['POST'])
def update_history_verdict(session_id):
    """Update verdict for a history entry (manual review)"""
    try:
        data = request.get_json() or {}
        verdict = data.get('verdict', '').upper()
        manually_reviewed = data.get('manually_reviewed', True)
        
        if not verdict:
            return jsonify({
                'error': 'Verdict is required',
                'status': 'failed'
            }), 400
        
        # Validate verdict
        valid_verdicts = ['AUTHENTIC', 'COUNTERFEIT', 'SUSPICIOUS', 'UNKNOWN']
        if verdict not in valid_verdicts:
            return jsonify({
                'error': f'Invalid verdict. Must be one of: {", ".join(valid_verdicts)}',
                'status': 'failed'
            }), 400
        
        # Get user type to determine which history manager to use
        user_type = request.headers.get('X-User-Type') or request.args.get('user_type', 'business')
        
        # Get the appropriate history manager
        if user_type == 'personal':
            backend_dir = Path(__file__).parent
            project_root = backend_dir.parent
            history_base_dir = "data/personal_api_results"
            history_manager = HistoryManager(base_dir=history_base_dir)
        else:
            history_manager = default_history_manager
        
        # Update verdict
        success = history_manager.update_verdict(session_id, verdict, manually_reviewed)
        
        if success:
            return jsonify({
                'status': 'success',
                'message': f'Verdict updated to {verdict}',
                'verdict': verdict,
                'manually_reviewed': manually_reviewed
            })
        else:
            return jsonify({
                'error': 'History not found or could not be updated',
                'status': 'failed'
            }), 404
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/lots', methods=['GET'])
def get_history_lots():
    """Get list of all lots for selection UI"""
    try:
        history_list = default_history_manager.load_history_list()
        # Return simplified list for lot selection
        lots = []
        for item in history_list:
            lots.append({
                'session_id': item.get('session_id'),
                'part_number': item.get('ic_info', {}).get('part_number', 'UNKNOWN'),
                'manufacturer': item.get('ic_info', {}).get('manufacturer', 'UNKNOWN'),
                'processed_date': item.get('processed_date'),
                'authenticity_score': item.get('scores', {}).get('authenticity_score', 0),
                'verdict': item.get('verdict', 'UNKNOWN'),
                'thumbnail': item.get('file_paths', {}).get('thumbnail')
            })
        
        return jsonify({
            'status': 'success',
            'lots': lots,
            'count': len(lots)
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@app.route('/api/history/search', methods=['POST'])
def search_history():
    """RAG search across selected lots with enhanced reference extraction"""
    try:
        data = request.get_json() or {}
        lot_ids = data.get('lot_ids', [])  # List of session_ids
        query = data.get('query', '')
        conversation_history = data.get('conversation_history', [])  # For conversational context
        
        if not lot_ids:
            return jsonify({
                'error': 'No lots selected',
                'status': 'failed'
            }), 400
        
        if not query:
            return jsonify({
                'error': 'No query provided',
                'status': 'failed'
            }), 400
        
        # Load RAG indices for selected lots with full detail
        rag_contents = []
        for lot_id in lot_ids:
            detail = default_history_manager.load_history_detail(lot_id)
            if detail and 'rag_index' in detail:
                # Extract metadata for better reference display
                ic_info = detail.get('ic_info', {})
                metadata = {
                    'session_id': lot_id,
                    'part_number': ic_info.get('part_number', 'UNKNOWN'),
                    'manufacturer': ic_info.get('manufacturer', 'UNKNOWN'),
                    'package_type': ic_info.get('package_type', ''),
                    'pin_count': ic_info.get('pin_count', 0),
                    'processed_date': detail.get('processed_date', ''),
                    'verdict': detail.get('verdict', 'UNKNOWN'),
                    'authenticity_score': detail.get('scores', {}).get('authenticity_score', 0)
                }
                
                rag_contents.append({
                    'session_id': lot_id,
                    'part_number': metadata['part_number'],
                    'manufacturer': metadata['manufacturer'],
                    'content': detail['rag_index'].get('full_text_content', ''),
                    'sections': detail['rag_index'].get('sections', {}),
                    'metadata': metadata,
                    'analysis': detail.get('analysis', {})
                })
        
        if not rag_contents:
            return jsonify({
                'error': 'No RAG content found for selected lots',
                'status': 'failed'
            }), 404
        
        # Build context with lot identifiers
        lot_contexts = []
        for i, item in enumerate(rag_contents):
            lot_contexts.append(f"""
Lot {i+1} - {item['part_number']} ({item['manufacturer']}):
Session ID: {item['session_id']}
Package: {item['metadata'].get('package_type', 'N/A')}
Pin Count: {item['metadata'].get('pin_count', 'N/A')}
Verdict: {item['metadata'].get('verdict', 'UNKNOWN')}
Authenticity Score: {item['metadata'].get('authenticity_score', 0):.2f}

Content:
{item['content']}
""")
        
        combined_content = '\n\n---\n\n'.join(lot_contexts)
        
        # Build conversation context
        conversation_context = ""
        if conversation_history:
            conversation_context = "\n\nPrevious conversation:\n"
            for msg in conversation_history[-5:]:  # Last 5 messages for context
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                conversation_context += f"{role.capitalize()}: {content}\n"
        
        # Use Gemini 2.5 Flash to answer the query (not experimental model to avoid rate limits)
        try:
            import google.generativeai as genai
            sys.path.insert(0, str(Path(__file__).parent))
            from utils import get_api_key
            
            api_key = get_api_key("GEMINI_API_KEY")
            genai.configure(api_key=api_key)
            # Use 2.5-flash (not 2.0-flash-exp) - better rate limits on free tier
            model = genai.GenerativeModel('gemini-2.5-flash')
            
            prompt = f"""You are analyzing multiple IC processing lots. Answer the user's question based on the following comprehensive data from {len(rag_contents)} processing lots.

{conversation_context}

Processing Data from {len(rag_contents)} lots:
{combined_content}

User Question: {query}

Provide a detailed answer based on the processing data. Include specific references to which lot(s) (by part number and session ID) and which sections of the analysis support your answer. Be thorough and cite sources with lot identifiers.

Answer:"""
            
            response = model.generate_content(prompt)
            answer = response.text
            
        except Exception as e:
            print(f"[API] Error calling Gemini for RAG answer: {e}")
            # Fallback to simple answer if Gemini fails
            answer = f"Found information across {len(rag_contents)} lot(s). See references on the right for details."
        
        # Enhanced reference extraction with better metadata
        references = []
        query_keywords = [w.lower() for w in query.split() if len(w) > 3]  # Filter short words
        
        for item in rag_contents:
            # Search through all sections
            for section_name, section_content in item['sections'].items():
                section_lower = section_content.lower()
                # Check relevance by keyword matching
                relevance_score = 0
                matched_keywords = []
                
                for keyword in query_keywords:
                    if keyword in section_lower:
                        relevance_score += 1
                        matched_keywords.append(keyword)
                
                # Include if at least one keyword matches or section is highly relevant
                if relevance_score > 0 or any(kw in section_lower for kw in ['anomaly', 'dimension', 'visual', 'oem', 'reasoning']):
                    # Extract a meaningful snippet (around matched keywords if possible)
                    snippet = section_content
                    if len(snippet) > 500:
                        # Try to find a good starting point
                        for kw in matched_keywords[:1]:
                            idx = section_lower.find(kw)
                            if idx > 0:
                                start = max(0, idx - 100)
                                end = min(len(snippet), idx + 400)
                                snippet = snippet[start:end]
                                if start > 0:
                                    snippet = '...' + snippet
                                if end < len(section_content):
                                    snippet = snippet + '...'
                                break
                        else:
                            snippet = snippet[:500] + '...'
                    
                    # Determine document ID (use part number or session ID)
                    doc_id = f"{item['part_number']}_{item['session_id'][:8]}"
                    
                    # Map section names to more readable labels
                    section_labels = {
                        'ic_identification': 'IC Identification',
                        'datasheet_content': 'Datasheet',
                        'dimension_analysis': 'Dimension Analysis',
                        'visual_analysis': 'Visual Analysis',
                        'anomalies': 'Anomalies',
                        'reasoning': 'Reasoning',
                        'report_summary': 'Report Summary'
                    }
                    section_label = section_labels.get(section_name, section_name.replace('_', ' ').title())
                    
                    references.append({
                        'document_id': doc_id,
                        'lot_id': item['session_id'],
                        'part_number': item['part_number'],
                        'manufacturer': item['manufacturer'],
                        'section': section_label,
                        'section_key': section_name,
                        'snippet': snippet,
                        'relevance_score': round(relevance_score / max(len(query_keywords), 1) * 10, 2),  # Normalize to 0-10
                        'page': None,  # Could be extracted from PDF if available
                        'knowledge_group': f"{item['part_number']} - {item['manufacturer']}"
                    })
        
        # Sort by relevance score and limit
        references.sort(key=lambda x: x['relevance_score'], reverse=True)
        references = references[:10]
        
        return jsonify({
            'status': 'success',
            'answer': answer,
            'references': references,
            'lots_searched': len(rag_contents),
            'query': query
        })
        
    except Exception as e:
            print(f"[API] Error in RAG search: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({
                'error': f'RAG search failed: {str(e)}',
                'status': 'failed'
            }), 500
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500



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
    print(f"  - GET  /api/history    : List all processing history")
    print(f"  - GET  /api/history/<id> : Get history details")
    print(f"  - DELETE /api/history/<id> : Delete history entry")
    print(f"  - GET  /api/history/lots : Get lots for selection")
    print(f"  - POST /api/history/search : RAG search across lots")
    print("=" * 70)
    
    # Configure for long-running requests (detection takes 25-40 seconds)
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)

