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

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pathlib import Path
import json
import uuid
from datetime import datetime
import sys

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from agents.counterfeit_detector import CounterfeitDetector

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend

# Initialize detector
detector = CounterfeitDetector(output_dir="api_results")

# Store active sessions
sessions = {}


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'counterfeit-ic-detector',
        'timestamp': datetime.now().isoformat()
    })


@app.route('/api/detect', methods=['POST'])
def detect_counterfeit():
    """
    Main detection endpoint
    
    Accepts:
        - image: IC image file (multipart/form-data)
        
    Returns:
        - session_id: Unique session ID for tracking
        - status: 'processing' | 'completed' | 'failed'
        - message: Status message
    """
    try:
        # Check if image was uploaded
        if 'image' not in request.files:
            return jsonify({
                'error': 'No image file provided',
                'status': 'failed'
            }), 400
        
        image_file = request.files['image']
        
        if image_file.filename == '':
            return jsonify({
                'error': 'Empty filename',
                'status': 'failed'
            }), 400
        
        # Generate session ID
        session_id = str(uuid.uuid4())
        
        # Save uploaded image
        upload_dir = Path('api_results') / 'uploads'
        upload_dir.mkdir(parents=True, exist_ok=True)
        
        image_path = upload_dir / f"{session_id}_{image_file.filename}"
        image_file.save(str(image_path))
        
        # Initialize session
        sessions[session_id] = {
            'status': 'processing',
            'image_path': str(image_path),
            'started_at': datetime.now().isoformat()
        }
        
        # Run detection (synchronous for now, can be made async)
        try:
            print(f"[API] Starting detection for session {session_id}...")
            result = detector.detect(str(image_path))
            print(f"[API] Detection completed for session {session_id}")
            
            # Update session with results
            sessions[session_id].update({
                'status': 'completed',
                'result': result,
                'completed_at': datetime.now().isoformat()
            })
            
            # Generate chat-style response
            chat_response = generate_chat_response(result)
            
            return jsonify({
                'session_id': session_id,
                'status': 'completed',
                'result': {
                    'verdict': result.verdict,
                    'score': result.authenticity_score,
                    'part_number': result.part_number,
                    'manufacturer': result.manufacturer,
                    'package_type': result.package_type,
                    'anomalies_count': len(result.anomalies),
                    'report_path': getattr(result, 'report_path', None),
                    'chat_response': chat_response
                }
            })
            
        except Exception as e:
            sessions[session_id].update({
                'status': 'failed',
                'error': str(e),
                'failed_at': datetime.now().isoformat()
            })
            
            return jsonify({
                'session_id': session_id,
                'status': 'failed',
                'error': str(e)
            }), 500
            
    except Exception as e:
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


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
        result = session['result']
        response['result'] = {
            'verdict': result.verdict,
            'score': result.authenticity_score,
            'part_number': result.part_number,
            'manufacturer': result.manufacturer,
            'package_type': result.package_type,
            'anomalies_count': len(result.anomalies),
            'report_path': getattr(result, 'report_path', None)
        }
    elif session['status'] == 'failed':
        response['error'] = session.get('error', 'Unknown error')
    
    return jsonify(response)


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
    
    report_path = getattr(session['result'], 'report_path', None)
    
    if not report_path or not Path(report_path).exists():
        return jsonify({
            'error': 'Report file not found'
        }), 404
    
    return send_file(
        report_path,
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
    messages.append({
        'type': 'step',
        'title': '🔍 IC Identification',
        'content': f"I've identified this as a **{result.part_number}** from **{result.manufacturer}**.\n\n"
                   f"📦 Package: {result.package_type}\n"
                   f"📌 Pin Count: {result.pin_count}"
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
            source_text = "extracted from the datasheet diagram using AI"
        elif dim_source == 'datasheet_parser':
            source_text = "parsed from the datasheet"
        else:
            source_text = "estimated from typical package dimensions"
        
        messages.append({
            'type': 'step',
            'title': '📐 Dimension Analysis',
            'content': f"**Expected Aspect Ratio:** {dim.get('expected_aspect_ratio', '?'):.2f} ({source_text})\n"
                       f"**Measured Aspect Ratio:** {dim.get('measured_aspect_ratio', '?'):.2f}\n"
                       f"**Match Score:** {dim.get('confidence_score', 0):.1f}/100\n\n"
                       f"{'✅ Dimensions match expected values' if dim.get('confidence_score', 0) > 80 else '⚠️ Dimensional discrepancy detected'}"
        })
    
    # Step 4: Visual Analysis
    if result.visual_comparison:
        visual = result.visual_comparison
        text_score = visual.get('text_quality_score', 0)
        
        messages.append({
            'type': 'step',
            'title': '👁️ Visual Analysis',
            'content': f"**Text Quality:** {text_score}/100\n"
                       f"**Pin Count Verified:** {'✅ Yes' if visual.get('pin_count_verified') else '❌ No'}\n"
                       f"**Package Type Verified:** {'✅ Yes' if visual.get('package_type_verified') else '❌ No'}\n\n"
                       f"**Key Observations:**\n" + 
                       '\n'.join([f"• {obs}" for obs in visual.get('observations', [])[:3]])
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
    verdict_emoji = {
        'AUTHENTIC': '✅',
        'LIKELY AUTHENTIC': '✅',
        'SUSPICIOUS': '⚠️',
        'SUSPICIOUS - REQUIRES INSPECTION': '⚠️',
        'COUNTERFEIT': '❌',
        'LIKELY COUNTERFEIT': '❌'
    }.get(result.verdict, '❓')
    
    verdict_color = {
        'AUTHENTIC': 'success',
        'LIKELY AUTHENTIC': 'success',
        'SUSPICIOUS': 'warning',
        'SUSPICIOUS - REQUIRES INSPECTION': 'warning',
        'COUNTERFEIT': 'danger',
        'LIKELY COUNTERFEIT': 'danger'
    }.get(result.verdict, 'info')
    
    messages.append({
        'type': 'verdict',
        'color': verdict_color,
        'title': f'{verdict_emoji} Final Verdict',
        'content': f"**{result.verdict}**\n\n"
                   f"**Authenticity Score:** {result.authenticity_score:.1f}/100\n\n"
                   f"{result.reasoning if hasattr(result, 'reasoning') else ''}"
    })
    
    # Report download
    messages.append({
        'type': 'action',
        'title': '📄 Detailed Report',
        'content': 'A comprehensive PDF report with annotated images and detailed analysis has been generated.',
        'action': 'download_report'
    })
    
    return messages


if __name__ == '__main__':
    print("=" * 70)
    print("🚀 Counterfeit IC Detection API Server")
    print("=" * 70)
    print(f"Starting server on http://localhost:5001")
    print(f"API Endpoints:")
    print(f"  - POST /api/detect     : Upload IC image for detection")
    print(f"  - GET  /api/session/:id : Get session status")
    print(f"  - GET  /api/report/:id  : Download PDF report")
    print("=" * 70)
    
    # Configure for long-running requests (detection takes 25-40 seconds)
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)

