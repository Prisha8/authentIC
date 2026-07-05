#!/usr/bin/env python3
"""authentIC public web server (laptop host, torch-free).

Slim port of backend/api_server.py for the public portfolio site:
  - single anonymous user space (the old "business" flow, data/api_results)
  - GPU stages via server.gpu_client (Modal in production)
  - demo IC replays of recorded real runs (free, instant-ish, rate-limit exempt)
  - per-IP + global rate limits guarding Gemini/Tavily/Modal budgets
  - safe artifact serving (no absolute paths, no traversal)
  - serves the static web/ frontend

Run (dev):      python -m server.app
Run (prod):     gunicorn -w 1 --threads 8 -b 0.0.0.0:8090 server.app:app
Single worker is required: session/progress state is in-process.
"""

import os
os.environ.setdefault('MPLBACKEND', 'Agg')

import matplotlib
matplotlib.use('Agg')

import json
import queue
import re
import threading
import traceback
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory
from werkzeug.exceptions import RequestEntityTooLarge

from server import config
from server import demo_replay
from server import rate_limiter
from server import security
from server.detection_runner import (RecordingQueue, detect_with_progress,
                                     make_web_detector, _rel_to_data)
from server.summaries import generate_chat_response

from utils.history_manager import HistoryManager

try:
    from utils.vector_db import get_vector_db
    VECTOR_DB_AVAILABLE = True
except ImportError as e:
    print(f"[Server] Vector DB not available: {e}")
    VECTOR_DB_AVAILABLE = False
    get_vector_db = None

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH

history_manager = HistoryManager(base_dir=config.HISTORY_BASE_DIR)

sessions = {}
progress_queues = {}

# Only one live (GPU/Gemini) detection at a time on the 8GB host
detection_slot = threading.Semaphore(1)


@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(e):
    return jsonify({
        'error': f'Upload too large. Maximum request size is '
                 f'{config.MAX_CONTENT_LENGTH // (1024 * 1024)} MB.',
        'status': 'failed',
    }), 413


@app.after_request
def security_headers(resp):
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    resp.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    return resp


# --------------------------------------------------------------------------
# Health + demos + quota
# --------------------------------------------------------------------------

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'counterfeit-ic-detector-web',
        'gpu_backend': config.GPU_BACKEND,
        'timestamp': datetime.now().isoformat(),
    })


@app.route('/api/demos', methods=['GET'])
def list_demos():
    return jsonify({'status': 'success', 'demos': demo_replay.list_demos()})


@app.route('/api/quota', methods=['GET'])
def quota():
    ip = rate_limiter.client_ip(request)
    return jsonify({
        'live_detections_remaining': rate_limiter.remaining(rate_limiter.KIND_DETECT, ip),
        'chat_messages_remaining': rate_limiter.remaining(rate_limiter.KIND_CHAT, ip),
    })


# --------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------

def _new_session(extra=None):
    session_id = str(uuid.uuid4())
    progress_queue = queue.Queue()
    progress_queues[session_id] = progress_queue
    sessions[session_id] = {
        'status': 'processing',
        'started_at': datetime.now().isoformat(),
        'progress': [],
        'current_step': 'Initializing...',
        **(extra or {}),
    }
    return session_id, progress_queue


@app.route('/api/detect', methods=['POST'])
def detect():
    """Start a detection: either a cached demo replay or a live pipeline run."""
    try:
        demo_id = request.form.get('demo_id') or request.args.get('demo_id') \
            or ((request.get_json(silent=True) or {}).get('demo_id')
                if not request.files else None)

        if demo_id:
            return _start_demo_replay(demo_id)
        return _start_live_detection()
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


def _start_demo_replay(demo_id: str):
    demo = demo_replay.get_demo(demo_id)
    if not demo:
        return jsonify({'error': f'Unknown demo: {demo_id}', 'status': 'failed'}), 404
    problem = demo_replay.replay_available(demo)
    if problem:
        return jsonify({'error': problem, 'status': 'failed'}), 500

    session_id, progress_queue = _new_session({'demo_id': demo_id})
    demo_replay.start_replay(demo, session_id, sessions, progress_queue)
    return jsonify({
        'session_id': session_id,
        'status': 'processing',
        'message': 'Detection started',
        'demo': True,
    })


def _start_live_detection():
    ip = rate_limiter.client_ip(request)

    # Collect + validate uploads before consuming quota
    image_files = []
    if 'images' in request.files:
        image_files = request.files.getlist('images')
    elif 'image' in request.files:
        image_files = [request.files['image']]
    if not image_files:
        return jsonify({'error': 'No image files provided', 'status': 'failed'}), 400
    if len(image_files) > config.MAX_IMAGES_PER_REQUEST:
        return jsonify({'error': f'Too many images (max {config.MAX_IMAGES_PER_REQUEST}).',
                        'status': 'failed'}), 400

    validated = []
    for f in image_files:
        f.seek(0)
        data = f.read()
        png_bytes, err = security.validate_and_reencode_image(f.filename, data)
        if err:
            return jsonify({'error': err, 'status': 'failed'}), 400
        validated.append((Path(f.filename).stem, png_bytes))

    # One at a time on this small host
    if not detection_slot.acquire(blocking=False):
        return jsonify({
            'error': 'Another analysis is currently running. Try again in a minute — '
                     'or explore the demo ICs, they replay instantly.',
            'status': 'busy',
        }), 409

    allowed, info = rate_limiter.check_and_record(rate_limiter.KIND_DETECT, ip)
    if not allowed:
        detection_slot.release()
        return jsonify({'error': info['message'], 'status': 'rate_limited',
                        'reason': info['reason']}), 429

    additional_info = request.form.get('additional_info', '')

    session_id, raw_queue = _new_session({'live': True})
    session_dir = config.DATA_DIR / 'history' / session_id
    progress_queue = RecordingQueue(raw_queue, session_dir / 'progress_events.json')

    upload_dir = config.DATA_DIR / 'uploads'
    upload_dir.mkdir(parents=True, exist_ok=True)
    all_image_paths = []
    for idx, (stem, png_bytes) in enumerate(validated):
        image_path = upload_dir / f"{session_id}_{idx}_{re.sub(r'[^A-Za-z0-9_-]', '_', stem)}.png"
        image_path.write_bytes(png_bytes)
        all_image_paths.append(str(image_path.resolve()))

    def run_detection():
        try:
            detector = make_web_detector(session_id)
            result = detect_with_progress(
                detector, session_id, progress_queue,
                all_image_paths=all_image_paths,
                uploaded_pdf_path=None,
                additional_info=additional_info,
            )

            chat_response = generate_chat_response(result)
            results_list = [{
                'verdict': result.verdict,
                'score': result.authenticity_score,
                'part_number': result.part_number,
                'manufacturer': result.manufacturer,
                'package_type': result.package_type,
                'anomalies_count': len(result.anomalies),
                'report_path': _rel_to_data(getattr(result, 'report_path', None)),
                'chat_response': chat_response,
                'dimension_viz': _rel_to_data(getattr(result, 'dimension_visualization', None)),
            }]

            # Persist history + vector index
            try:
                progress_data = sessions[session_id].get('progress', [])
                history_manager.save_processing(result, session_id, progress_data)
                if VECTOR_DB_AVAILABLE and get_vector_db:
                    try:
                        vector_db = get_vector_db()
                        if vector_db:
                            detail = history_manager.load_history_detail(session_id)
                            if detail:
                                vector_db.store_analysis(
                                    session_id=session_id,
                                    metadata=detail.get('metadata', {}),
                                    analysis_data=detail.get('analysis', {}),
                                    tool_outputs=detail.get('analysis', {}).get('tool_outputs', {}),
                                )
                    except Exception as vec_error:
                        print(f"[Server] Vector DB store failed: {vec_error}")
            except Exception as e:
                print(f"[Server] Failed to save history: {e}")
                traceback.print_exc()

            # Persist results for replay/demo promotion and post-restart reads
            try:
                session_dir.mkdir(parents=True, exist_ok=True)
                (session_dir / 'results.json').write_text(
                    json.dumps(results_list, indent=2, default=str))
            except Exception as e:
                print(f"[Server] Failed to persist results.json: {e}")

            sessions[session_id].update({
                'status': 'completed',
                'results': results_list,
                'completed_at': datetime.now().isoformat(),
                'current_step': 'Complete',
            })
            progress_queue.put({'type': 'complete', 'session_id': session_id})

        except Exception as e:
            error_msg = str(e)
            print(f"[Server] Detection thread error: {error_msg}")
            traceback.print_exc()
            sessions[session_id].update({
                'status': 'failed',
                'error': error_msg,
                'failed_at': datetime.now().isoformat(),
            })
            progress_queue.put({'type': 'error', 'message': error_msg})
        finally:
            detection_slot.release()

    threading.Thread(target=run_detection, daemon=True).start()

    return jsonify({
        'session_id': session_id,
        'status': 'processing',
        'message': 'Detection started',
        'live_detections_remaining': info.get('remaining'),
    })


@app.route('/api/progress/<session_id>', methods=['GET'])
def get_progress(session_id):
    if session_id not in sessions:
        return jsonify({'updates': [], 'error': 'Session not found',
                        'session': None, 'status': 'not_found'}), 200
    if session_id not in progress_queues:
        return jsonify({'updates': [], 'session': sessions[session_id]})

    updates = []
    progress_queue = progress_queues[session_id]
    while True:
        try:
            update = progress_queue.get_nowait()
        except queue.Empty:
            break
        updates.append(update)
        if 'step' in update:
            sessions[session_id].setdefault('progress', []).append(update)
            if update.get('status') == 'running':
                sessions[session_id]['current_step'] = update.get('title', 'Processing...')

    return jsonify({'updates': updates, 'session': sessions[session_id]})


@app.route('/api/session/<session_id>', methods=['GET'])
def get_session(session_id):
    if session_id not in sessions:
        return jsonify({'error': 'Session not found', 'status': 'not_found'}), 404
    session = sessions[session_id]
    response = {
        'session_id': session_id,
        'status': session['status'],
        'started_at': session['started_at'],
    }
    if session['status'] == 'completed':
        response['results'] = session.get('results', [])
    elif session['status'] == 'failed':
        response['error'] = session.get('error', 'Unknown error')
    return jsonify(response)


# --------------------------------------------------------------------------
# Artifact + report serving (locked down)
# --------------------------------------------------------------------------

@app.route('/api/download', methods=['GET'])
def download_file():
    """Serve an artifact by path relative to the results dir or demo cache."""
    file_path = request.args.get('file')
    if not file_path:
        return jsonify({'error': 'No file specified'}), 400
    resolved = security.resolve_artifact(file_path)
    if resolved is None:
        return jsonify({'error': 'File not found'}), 404
    return send_file(str(resolved), mimetype=security.mimetype_for(resolved),
                     as_attachment=False)


@app.route('/api_results/<path:filename>')
def serve_result_file(filename):
    resolved = security.resolve_artifact(filename)
    if resolved is None:
        return jsonify({'error': 'File not found'}), 404
    return send_file(str(resolved), mimetype=security.mimetype_for(resolved),
                     as_attachment=False)


def _resolve_report_path(session_id):
    """Find a session's PDF report across live state, disk, and history."""
    session = sessions.get(session_id)
    candidates = []
    if session:
        results = session.get('results') or []
        if results and isinstance(results[0], dict) and results[0].get('report_path'):
            candidates.append(results[0]['report_path'])
        source_sid = session.get('source_session_id')
    else:
        source_sid = None

    for sid in filter(None, [session_id, source_sid]):
        candidates.append(f"history/{sid}/reports/analysis_report.pdf")

    for cand in candidates:
        p = Path(cand)
        if not p.is_absolute():
            p = config.DATA_DIR / cand
        try:
            p = p.resolve()
            if p.is_relative_to(config.DATA_DIR.resolve()) and p.exists():
                return p
        except (OSError, ValueError):
            continue

    for sid in filter(None, [session_id, source_sid]):
        matches = list((config.DATA_DIR / 'history' / sid).glob('reports/*.pdf')) \
            if (config.DATA_DIR / 'history' / sid).exists() else []
        matches += list(config.DATA_DIR.glob(f"*{sid}*.pdf"))
        if matches:
            return matches[0]
    return None


@app.route('/api/report/<session_id>', methods=['GET'])
def download_report(session_id):
    report = _resolve_report_path(session_id)
    if report is None:
        return jsonify({'error': 'Report not found'}), 404
    return send_file(str(report), mimetype='application/pdf', as_attachment=True,
                     download_name=f"counterfeit_report_{session_id}.pdf")


# --------------------------------------------------------------------------
# Chat
# --------------------------------------------------------------------------

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        ip = rate_limiter.client_ip(request)
        allowed, info = rate_limiter.check_and_record(rate_limiter.KIND_CHAT, ip)
        if not allowed:
            return jsonify({'error': info['message'], 'status': 'rate_limited'}), 429

        from agents.conversational_agent import get_agent
        agent = get_agent()

        data = request.get_json(silent=True) or {}
        message = data.get('message', '') or request.form.get('message', '')
        session_id = data.get('session_id') or request.form.get('session_id') or str(uuid.uuid4())
        chat_history = data.get('chat_history', [])

        if not message:
            return jsonify({'error': 'No message provided', 'status': 'failed'}), 400

        has_image = False
        image_path = None
        if 'image' in request.files:
            image_file = request.files['image']
            if image_file.filename:
                image_file.seek(0)
                png_bytes, err = security.validate_and_reencode_image(
                    image_file.filename, image_file.read())
                if err:
                    return jsonify({'error': err, 'status': 'failed'}), 400
                upload_dir = config.DATA_DIR / 'uploads'
                upload_dir.mkdir(parents=True, exist_ok=True)
                image_path_obj = upload_dir / f"chat_{session_id}.png"
                image_path_obj.write_bytes(png_bytes)
                image_path = str(image_path_obj.resolve())
                has_image = True

        result = agent.chat(message=message, session_id=session_id,
                            chat_history=chat_history, has_image=has_image,
                            image_path=image_path)
        return jsonify({
            'response': result['response'],
            'should_trigger_detection': result['should_trigger_detection'],
            'session_id': session_id,
            'reasoning': result.get('reasoning', ''),
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


@app.route('/api/chat/clear/<session_id>', methods=['POST'])
def clear_chat_session(session_id):
    try:
        from agents.conversational_agent import get_agent
        get_agent().clear_session(session_id)
        return jsonify({'status': 'success', 'message': 'Chat session cleared'})
    except Exception as e:
        return jsonify({'error': str(e), 'status': 'failed'}), 500


# --------------------------------------------------------------------------
# History
# --------------------------------------------------------------------------

def _extract_coo(identify_data) -> str:
    """Best-effort country-of-origin from the identify tool output."""
    country_codes = identify_data.get('country_codes', [])
    if country_codes and isinstance(country_codes, list):
        coo = str(country_codes[0]).upper()
        if coo and coo != 'UNKNOWN':
            return coo

    parts = []
    for m in identify_data.get('additional_markings', []) or []:
        if isinstance(m, dict):
            parts += [str(m.get('text', '')), str(m.get('decoded', ''))]
    for lot in identify_data.get('lot_codes', []) or []:
        if isinstance(lot, dict):
            parts += [str(lot.get('raw', '')), str(lot.get('meaning', '')),
                      str(lot.get('location', ''))]
        else:
            parts.append(str(lot))
    parts += [str(identify_data.get('part_number', '')),
              str(identify_data.get('reasoning', ''))]
    all_text = ' '.join(parts).upper()

    for code, pattern in [('CHN', r'\bCHN\b'), ('MYS', r'\bMYS\b'), ('TW', r'\bTW\b'),
                          ('MY', r'\bMY\b(?!S)'), ('CN', r'\bCN\b(?!H)'),
                          ('PH', r'\bPH\b'), ('US', r'\bUS\b(?!A)'), ('JP', r'\bJP\b')]:
        if re.search(pattern, all_text):
            return code
    return ''


def _enrich_coo(item):
    session_id = item.get('session_id')
    if not session_id:
        return
    try:
        detail = history_manager.load_history_detail(session_id)
        identify_output = (detail or {}).get('analysis', {}).get('tool_outputs', {}).get('identify')
        if not identify_output:
            return
        identify_data = (identify_output.get('data') or identify_output.get('result')
                         or identify_output)
        coo = _extract_coo(identify_data)
        if coo:
            item.setdefault('ic_info', {})['coo'] = coo
    except Exception:
        pass


@app.route('/api/history', methods=['GET'])
def get_history():
    try:
        search_query = request.args.get('search', '').strip()
        use_vector_search = request.args.get('vector_search', 'false').lower() == 'true'
        limit = request.args.get('limit', type=int)

        filters = {}
        verdict = request.args.get('verdict')
        if verdict and verdict != 'all':
            filters['verdict'] = verdict
        manufacturer = request.args.get('manufacturer')
        if manufacturer:
            filters['manufacturer'] = manufacturer

        if search_query and VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                if use_vector_search:
                    results = vector_db.vector_search(query=search_query, limit=limit or 50,
                                                      filters=filters or None)
                    search_type = 'vector'
                else:
                    results = vector_db.text_search(query=search_query, limit=limit or 50,
                                                    filters=filters or None)
                    search_type = 'text'
                history_list = []
                for row in results:
                    metadata = row.get('metadata', {})
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)
                    item = {
                        'session_id': row['session_id'],
                        'processed_date': (row['processed_date'].isoformat()
                                           if hasattr(row['processed_date'], 'isoformat')
                                           else str(row['processed_date'])),
                        'verdict': row.get('verdict', 'UNKNOWN'),
                        'similarity': row.get('similarity'),
                        'rank': row.get('rank'),
                    }
                    if metadata:
                        item.update(metadata)
                    history_list.append(item)
                return jsonify({'status': 'success', 'history': history_list,
                                'count': len(history_list), 'search_type': search_type})

        history_list = history_manager.load_history_list(limit=limit)
        for item in history_list:
            _enrich_coo(item)

        if filters:
            filtered = []
            for item in history_list:
                include = True
                if filters.get('verdict'):
                    vf = filters['verdict'].upper()
                    iv = str(item.get('verdict') or 'UNKNOWN').upper()
                    if vf == 'SUSPICIOUS':
                        include = 'SUSPICIOUS' in iv
                    elif vf == 'COUNTERFEIT':
                        include = 'COUNTERFEIT' in iv
                    elif vf == 'AUTHENTIC':
                        include = ('AUTHENTIC' in iv and 'SUSPICIOUS' not in iv
                                   and 'COUNTERFEIT' not in iv)
                    else:
                        include = iv == vf
                if include and filters.get('manufacturer'):
                    mf = filters['manufacturer'].lower()
                    include = mf in (item.get('ic_info', {}).get('manufacturer') or '').lower()
                if include:
                    filtered.append(item)
            history_list = filtered

        return jsonify({'status': 'success', 'history': history_list,
                        'count': len(history_list)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


@app.route('/api/history/lots', methods=['GET'])
def get_history_lots():
    try:
        history_list = history_manager.load_history_list()
        lots = [{
            'session_id': item.get('session_id'),
            'part_number': item.get('ic_info', {}).get('part_number', 'UNKNOWN'),
            'manufacturer': item.get('ic_info', {}).get('manufacturer', 'UNKNOWN'),
            'processed_date': item.get('processed_date'),
            'authenticity_score': item.get('scores', {}).get('authenticity_score', 0),
            'verdict': item.get('verdict', 'UNKNOWN'),
            'thumbnail': item.get('file_paths', {}).get('thumbnail'),
        } for item in history_list]
        return jsonify({'status': 'success', 'lots': lots, 'count': len(lots)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


@app.route('/api/history/search', methods=['POST'])
def search_history():
    """RAG search across selected lots (Gemini-answered, keyword references)."""
    try:
        ip = rate_limiter.client_ip(request)
        allowed, info = rate_limiter.check_and_record(rate_limiter.KIND_RAG, ip)
        if not allowed:
            return jsonify({'error': info['message'], 'status': 'rate_limited'}), 429

        data = request.get_json() or {}
        lot_ids = data.get('lot_ids', [])
        query = data.get('query', '')
        conversation_history = data.get('conversation_history', [])

        if not lot_ids:
            return jsonify({'error': 'No lots selected', 'status': 'failed'}), 400
        if not query:
            return jsonify({'error': 'No query provided', 'status': 'failed'}), 400

        rag_contents = []
        for lot_id in lot_ids:
            detail = history_manager.load_history_detail(lot_id)
            if detail and 'rag_index' in detail:
                ic_info = detail.get('ic_info', {})
                metadata = {
                    'session_id': lot_id,
                    'part_number': ic_info.get('part_number', 'UNKNOWN'),
                    'manufacturer': ic_info.get('manufacturer', 'UNKNOWN'),
                    'package_type': ic_info.get('package_type', ''),
                    'pin_count': ic_info.get('pin_count', 0),
                    'processed_date': detail.get('processed_date', ''),
                    'verdict': detail.get('verdict', 'UNKNOWN'),
                    'authenticity_score': detail.get('scores', {}).get('authenticity_score', 0),
                }
                rag_contents.append({
                    'session_id': lot_id,
                    'part_number': metadata['part_number'],
                    'manufacturer': metadata['manufacturer'],
                    'content': detail['rag_index'].get('full_text_content', ''),
                    'sections': detail['rag_index'].get('sections', {}),
                    'metadata': metadata,
                })

        if not rag_contents:
            return jsonify({'error': 'No RAG content found for selected lots',
                            'status': 'failed'}), 404

        lot_contexts = []
        for i, item in enumerate(rag_contents):
            lot_contexts.append(f"""
Lot {i + 1} - {item['part_number']} ({item['manufacturer']}):
Session ID: {item['session_id']}
Package: {item['metadata'].get('package_type', 'N/A')}
Pin Count: {item['metadata'].get('pin_count', 'N/A')}
Verdict: {item['metadata'].get('verdict', 'UNKNOWN')}
Authenticity Score: {item['metadata'].get('authenticity_score', 0):.2f}

Content:
{item['content']}
""")
        combined_content = '\n\n---\n\n'.join(lot_contexts)

        conversation_context = ""
        if conversation_history:
            conversation_context = "\n\nPrevious conversation:\n"
            for msg in conversation_history[-5:]:
                conversation_context += (f"{msg.get('role', 'user').capitalize()}: "
                                         f"{msg.get('content', '')}\n")

        try:
            import google.generativeai as genai
            from utils import get_api_key
            genai.configure(api_key=get_api_key("GEMINI_API_KEY"))
            from utils.gemini_fallback import FallbackGenerativeModel
            model = FallbackGenerativeModel('gemini-2.5-flash')
            prompt = f"""You are analyzing multiple IC processing lots. Answer the user's question based on the following comprehensive data from {len(rag_contents)} processing lots.

{conversation_context}

Processing Data from {len(rag_contents)} lots:
{combined_content}

User Question: {query}

Provide a detailed answer based on the processing data. Include specific references to which lot(s) (by part number and session ID) and which sections of the analysis support your answer. Be thorough and cite sources with lot identifiers.

Answer:"""
            answer = model.generate_content(prompt).text
        except Exception as e:
            print(f"[Server] Gemini RAG answer failed: {e}")
            answer = (f"Found information across {len(rag_contents)} lot(s). "
                      f"See references on the right for details.")

        references = []
        query_keywords = [w.lower() for w in query.split() if len(w) > 3]
        section_labels = {
            'ic_identification': 'IC Identification',
            'datasheet_content': 'Datasheet',
            'dimension_analysis': 'Dimension Analysis',
            'visual_analysis': 'Visual Analysis',
            'anomalies': 'Anomalies',
            'reasoning': 'Reasoning',
            'report_summary': 'Report Summary',
        }
        for item in rag_contents:
            for section_name, section_content in item['sections'].items():
                section_lower = section_content.lower()
                matched = [kw for kw in query_keywords if kw in section_lower]
                relevance_score = len(matched)
                if relevance_score > 0 or any(kw in section_lower for kw in
                                              ['anomaly', 'dimension', 'visual', 'oem', 'reasoning']):
                    snippet = section_content
                    if len(snippet) > 500:
                        for kw in matched[:1]:
                            idx = section_lower.find(kw)
                            if idx > 0:
                                start = max(0, idx - 100)
                                end = min(len(snippet), idx + 400)
                                snippet = (('...' if start > 0 else '') + snippet[start:end]
                                           + ('...' if end < len(section_content) else ''))
                                break
                        else:
                            snippet = snippet[:500] + '...'
                    references.append({
                        'document_id': f"{item['part_number']}_{item['session_id'][:8]}",
                        'lot_id': item['session_id'],
                        'part_number': item['part_number'],
                        'manufacturer': item['manufacturer'],
                        'section': section_labels.get(section_name,
                                                      section_name.replace('_', ' ').title()),
                        'section_key': section_name,
                        'snippet': snippet,
                        'relevance_score': round(relevance_score / max(len(query_keywords), 1) * 10, 2),
                        'page': None,
                        'knowledge_group': f"{item['part_number']} - {item['manufacturer']}",
                    })

        references.sort(key=lambda x: x['relevance_score'], reverse=True)
        return jsonify({
            'status': 'success',
            'answer': answer,
            'references': references[:10],
            'lots_searched': len(rag_contents),
            'query': query,
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'RAG search failed: {e}', 'status': 'failed'}), 500


@app.route('/api/history/<session_id>', methods=['GET', 'DELETE'])
def get_history_detail(session_id):
    if request.method == 'DELETE':
        if not config.ALLOW_MUTATIONS:
            return jsonify({'error': 'Deleting history is disabled on the public demo.',
                            'status': 'forbidden'}), 403
        try:
            if history_manager.delete_history(session_id):
                return jsonify({'status': 'success', 'message': 'History deleted successfully'})
            return jsonify({'error': 'History not found or could not be deleted',
                            'status': 'failed'}), 404
        except Exception as e:
            traceback.print_exc()
            return jsonify({'error': str(e), 'status': 'failed'}), 500

    try:
        detail = history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({'error': 'History not found', 'status': 'not_found'}), 404
        return jsonify({'status': 'success', 'detail': detail})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


@app.route('/api/history/<session_id>/metadata', methods=['GET'])
def get_history_metadata(session_id):
    try:
        detail = history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({'error': 'History not found', 'status': 'not_found'}), 404
        metadata = {k: v for k, v in detail.items()
                    if k not in ('analysis', 'rag_index', 'progress')}
        return jsonify({'status': 'success', 'metadata': metadata})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


@app.route('/api/history/<session_id>/verdict', methods=['POST'])
def update_history_verdict(session_id):
    if not config.ALLOW_MUTATIONS:
        return jsonify({'error': 'Verdict overrides are disabled on the public demo.',
                        'status': 'forbidden'}), 403
    try:
        data = request.get_json() or {}
        verdict = data.get('verdict', '').upper()
        manually_reviewed = data.get('manually_reviewed', True)
        valid = ['AUTHENTIC', 'COUNTERFEIT', 'SUSPICIOUS', 'UNKNOWN']
        if not verdict:
            return jsonify({'error': 'Verdict is required', 'status': 'failed'}), 400
        if verdict not in valid:
            return jsonify({'error': f"Invalid verdict. Must be one of: {', '.join(valid)}",
                            'status': 'failed'}), 400
        if history_manager.update_verdict(session_id, verdict, manually_reviewed):
            return jsonify({'status': 'success', 'message': f'Verdict updated to {verdict}',
                            'verdict': verdict, 'manually_reviewed': manually_reviewed})
        return jsonify({'error': 'History not found or could not be updated',
                        'status': 'failed'}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


@app.route('/api/history/<session_id>/download', methods=['GET'])
def download_history_report(session_id):
    try:
        detail = history_manager.load_history_detail(session_id)
        if not detail:
            return jsonify({'error': 'History not found'}), 404
        report_path = detail.get('file_paths', {}).get('report_pdf')
        if not report_path:
            return jsonify({'error': 'Report not found'}), 404
        resolved = security.resolve_artifact(report_path)
        if resolved is None:
            return jsonify({'error': 'Report file not found'}), 404
        return send_file(str(resolved), mimetype='application/pdf', as_attachment=True,
                         download_name=f"counterfeit_report_{session_id}.pdf")
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'status': 'failed'}), 500


# --------------------------------------------------------------------------
# Annotations (reads open, writes gated)
# --------------------------------------------------------------------------

@app.route('/api/annotations', methods=['POST'])
def create_annotation():
    if not config.ALLOW_MUTATIONS:
        return jsonify({'error': 'Annotations are disabled on the public demo.'}), 403
    try:
        data = request.json or {}
        session_id = data.get('session_id')
        if not session_id:
            return jsonify({'error': 'session_id required'}), 400
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
            'correction_to_ai': data.get('correction_to_ai', False),
        }
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db and vector_db.store_annotation(session_id, annotation):
                return jsonify({'success': True, 'annotation_id': annotation_id,
                                'message': 'Annotation saved successfully'}), 201
        return jsonify({'success': True, 'annotation_id': annotation_id,
                        'message': 'Annotation saved (vector DB unavailable)'}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/annotations/<session_id>', methods=['GET'])
def get_annotations(session_id):
    try:
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                annotations = vector_db.get_annotations_for_session(session_id)
                for ann in annotations:
                    ann.pop('embedding', None)
                    for key, value in list(ann.items()):
                        if hasattr(value, 'item'):
                            ann[key] = value.item()
                return jsonify({'annotations': annotations}), 200
        return jsonify({'annotations': []}), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'annotations': []}), 500


@app.route('/api/annotations/<annotation_id>', methods=['PUT', 'DELETE'])
def modify_annotation(annotation_id):
    if not config.ALLOW_MUTATIONS:
        return jsonify({'error': 'Annotations are disabled on the public demo.'}), 403
    try:
        if not (VECTOR_DB_AVAILABLE and get_vector_db):
            return jsonify({'error': 'Vector DB unavailable'}), 500
        vector_db = get_vector_db()
        if not vector_db:
            return jsonify({'error': 'Vector DB unavailable'}), 500

        if request.method == 'DELETE':
            session_id = request.args.get('session_id')
            if not session_id:
                return jsonify({'error': 'session_id required'}), 400
            conn = vector_db._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM ic_annotations WHERE annotation_id = %s AND session_id = %s",
                (annotation_id, session_id))
            conn.commit()
            vector_db._return_connection(conn)
            return jsonify({'success': True, 'message': 'Annotation deleted'}), 200

        data = request.json or {}
        session_id = data.get('session_id')
        if session_id:
            annotations = vector_db.get_annotations_for_session(session_id)
            existing = next((a for a in annotations
                             if a.get('annotation_id') == annotation_id), None)
            if existing:
                existing.update(data)
                existing['annotation_id'] = annotation_id
                if vector_db.store_annotation(session_id, existing):
                    return jsonify({'success': True, 'message': 'Annotation updated'}), 200
        return jsonify({'error': 'Annotation not found'}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/annotations/search', methods=['POST'])
def search_annotations():
    try:
        data = request.json or {}
        query = data.get('query', '')
        if not query:
            return jsonify({'error': 'query required'}), 400
        if VECTOR_DB_AVAILABLE and get_vector_db:
            vector_db = get_vector_db()
            if vector_db:
                results = vector_db.search_annotations(query, data.get('limit', 10),
                                                       data.get('filters', {}))
                for r in results:
                    r.pop('embedding', None)
                    for key, value in list(r.items()):
                        if hasattr(value, 'item'):
                            r[key] = value.item()
                return jsonify({'results': results}), 200
        return jsonify({'results': []}), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e), 'results': []}), 500


# --------------------------------------------------------------------------
# Static frontend (web/)
# --------------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory(config.WEB_DIR, 'index.html')


@app.route('/<path:filename>')
def static_files(filename):
    target = (config.WEB_DIR / filename)
    try:
        if target.resolve().is_relative_to(config.WEB_DIR.resolve()) and target.is_file():
            return send_from_directory(config.WEB_DIR, filename)
    except (OSError, ValueError):
        pass
    return jsonify({'error': 'Not found'}), 404


if __name__ == '__main__':
    print("=" * 70)
    print("authentIC web server")
    print(f"  GPU backend : {config.GPU_BACKEND}")
    print(f"  Data dir    : {config.DATA_DIR}")
    print(f"  Web dir     : {config.WEB_DIR}")
    print(f"  Port        : {config.SERVER_PORT}")
    print("=" * 70)
    app.run(host='0.0.0.0', port=config.SERVER_PORT, debug=False, threaded=True)
