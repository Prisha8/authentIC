"""Web port of the desktop detection orchestrator.

This is `_detect_with_progress` from backend/api_server.py adapted for the
public site:
  - the three torch-bound stages (SAM+EasyOCR preprocessing, YOLO pin count,
    histogram filters) go through server.gpu_client (Modal in production,
    in-process on a GPU dev box) instead of running inline;
  - artifact URLs are relative (`/api/download?file=...`) instead of
    hardcoded http://localhost:5001;
  - every progress event is also recorded to
    <session_dir>/progress_events.json with time offsets, and the final chat
    results to <session_dir>/results.json — this is what powers the cached
    demo replays and pre-populated history.

Stage semantics, progress event shapes and on-disk layout are kept identical
to the desktop pipeline so the existing frontend and HistoryManager work
unchanged.
"""

import json
import queue
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote

from server import config
from server.gpu_client import get_gpu_client


class RecordingQueue:
    """Wraps the in-memory progress queue and journals events to disk."""

    def __init__(self, inner: queue.Queue, record_path: Path):
        self.inner = inner
        self.record_path = record_path
        self.t0 = time.time()
        self.events: List[Dict] = []
        self._lock = threading.Lock()

    def put(self, event: Dict):
        self.inner.put(event)
        with self._lock:
            self.events.append({
                "t_offset": round(time.time() - self.t0, 3),
                "event": event,
            })
            try:
                self.record_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.record_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(self.events, indent=2, default=str))
                tmp.replace(self.record_path)
            except Exception as e:  # journaling must never break detection
                print(f"[Runner] Warning: failed to journal progress event: {e}")


def _rel_to_data(path_value) -> Optional[str]:
    """Path under DATA_DIR -> forward-slash relative string (else filename)."""
    if not path_value:
        return None
    p = Path(path_value)
    try:
        return p.resolve().relative_to(config.DATA_DIR.resolve()).as_posix()
    except ValueError:
        return p.name


def _download_url(path_value) -> Optional[str]:
    """Relative same-origin URL for an artifact under DATA_DIR."""
    rel = _rel_to_data(path_value)
    if not rel:
        return None
    return f"/api/download?file={quote(rel, safe='')}"


def make_web_detector(session_id: str = None):
    """CounterfeitDetector subclass with torch stages delegated to gpu_client.

    Built lazily (function-level import) so importing this module never pulls
    Gemini config or model deps at web-server import time.

    output_dir is per-session: with a shared dir, every run clobbers the
    previous session's histogram/pin/datasheet artifacts, breaking older
    sessions' replays and history detail pages.
    """
    from agents.counterfeit_detector import CounterfeitDetector

    gpu = get_gpu_client()

    class WebDetector(CounterfeitDetector):
        def _run_pin_counter(self, image_path):
            try:
                result = gpu.pin_count(str(image_path), self.output_dir)
                pin_dict = result.get("pin_dict") or {}
                viz = result.get("visualization")
                print(f"  ✓ Pin counter complete: {pin_dict.get('pins_detected', 0)} pins")
                return pin_dict, viz
            except Exception as e:
                print(f"  ✗ Pin counter failed: {e}")
                traceback.print_exc()
                return {}, None

        def _run_histogram_filter(self, image_path, result):
            try:
                stage = gpu.histogram(str(image_path), self.output_dir)
                manifest = stage.get("manifest") or {}
                dashboard = stage.get("dashboard")
                strips = stage.get("strips") or []
                print(f"  ✓ Histogram filter complete: {len(strips)} filter outputs")
                return manifest, dashboard, strips
            except Exception as e:
                print(f"  ✗ Histogram filter failed: {e}")
                traceback.print_exc()
                return {}, None, []

    output_dir = config.DATA_DIR / session_id if session_id else config.DATA_DIR
    return WebDetector(
        output_dir=str(output_dir),
        pin_counter_weights=config.PIN_COUNTER_WEIGHTS_PATH,
    )


def detect_with_progress(detector, session_id: str, progress_queue,
                         all_image_paths: List[str],
                         uploaded_pdf_path: Optional[str] = None,
                         additional_info: Optional[str] = None):
    """Run the full pipeline, emitting the same progress events as the desktop app."""
    from agents.counterfeit_detector import DetectionResult  # noqa: used in except too

    api_results_path = config.DATA_DIR.resolve()

    try:
        start_time = time.time()

        image_paths = [Path(p) for p in all_image_paths]
        primary_image_path = image_paths[0]
        if not primary_image_path.exists():
            raise FileNotFoundError(f"Image file not found: {primary_image_path}")

        result = DetectionResult(
            ic_image_path=str(primary_image_path),
            ic_image_paths=[str(p) for p in image_paths],
            timestamp=datetime.now().isoformat(),
            anomalies=[],
            additional_info=additional_info,
        )

        # STEP 0: Preprocessing (SAM crop + EasyOCR) — GPU worker
        progress_queue.put({
            'type': 'step', 'step': 'preprocess', 'title': 'Preprocessing Image',
            'status': 'running',
            'message': 'Segmenting IC and detecting text regions...'
        })

        preprocessing_output_dir = api_results_path / session_id / 'preprocessing'
        preprocessing_output_dir.mkdir(parents=True, exist_ok=True)

        gpu = get_gpu_client()
        preprocessing_result = gpu.preprocess(str(primary_image_path.resolve()),
                                              preprocessing_output_dir)

        cropped_image_path = preprocessing_result.get('output_ic_crop')
        ocr_visualization_path = preprocessing_result.get('output_textbox_viz')
        if not cropped_image_path or not Path(cropped_image_path).exists():
            raise FileNotFoundError(f"Preprocessing output not found: {cropped_image_path}")

        result.preprocessing_outputs = {
            'ic_crop': cropped_image_path,
            'ocr_visualization': ocr_visualization_path,
            'horizontal_0': preprocessing_result.get('output_0_deg'),
            'horizontal_180': preprocessing_result.get('output_180_deg'),
        }

        ocr_viz_url = _download_url(ocr_visualization_path)
        progress_queue.put({
            'type': 'step', 'step': 'preprocess', 'title': 'Preprocessing Image',
            'status': 'completed',
            'message': 'IC cropped, text regions and logo detected',
            'visualization': ocr_viz_url,
            'data': {
                'ic_crop_path': _rel_to_data(cropped_image_path),
                'ocr_visualization_path': _rel_to_data(ocr_visualization_path),
                'ocr_visualization_url': ocr_viz_url,
            }
        })

        # STEP 1: IC Identification (Gemini)
        progress_queue.put({
            'type': 'step', 'step': 'identify', 'title': 'Identifying IC',
            'status': 'running', 'message': 'Analyzing IC image with VLM...'
        })
        cropped_image_path_abs = Path(cropped_image_path).resolve()
        ic_info = detector._identify_ic(cropped_image_path_abs,
                                        additional_info=additional_info,
                                        all_images=[cropped_image_path_abs])
        result.part_number = ic_info.get('part_number', 'UNKNOWN')
        result.manufacturer = ic_info.get('manufacturer', 'UNKNOWN')
        result.package_type = ic_info.get('package_type', 'UNKNOWN')
        result.pin_count = ic_info.get('pin_count', 0)
        progress_queue.put({
            'type': 'step', 'step': 'identify', 'title': 'Identifying IC',
            'status': 'completed',
            'message': f'Identified: {result.part_number} ({result.manufacturer})',
            'data': ic_info,
        })

        # STEP 2: Datasheet (uploaded or scraped via Tavily)
        if uploaded_pdf_path and Path(uploaded_pdf_path).exists():
            progress_queue.put({
                'type': 'step', 'step': 'scrape', 'title': 'Using Uploaded OEM Datasheet',
                'status': 'completed', 'message': 'Using uploaded OEM datasheet',
                'data': {'datasheet_path': uploaded_pdf_path, 'source': 'uploaded'}
            })
            datasheet_path = str(Path(uploaded_pdf_path).resolve())
            result.datasheet_path = datasheet_path
        else:
            progress_queue.put({
                'type': 'step', 'step': 'scrape', 'title': 'Searching OEM Datasheet',
                'status': 'running',
                'message': f'Searching for {result.part_number} datasheet...'
            })
            datasheet_path = detector._scrape_datasheet(result.part_number)
            if datasheet_path:
                datasheet_path = str(Path(datasheet_path).resolve())
            result.datasheet_path = datasheet_path
            progress_queue.put({
                'type': 'step', 'step': 'scrape', 'title': 'Searching OEM Datasheet',
                'status': 'completed',
                'message': ('Datasheet retrieved successfully' if datasheet_path
                            else 'No datasheet found (will proceed without it)'),
                'data': ({'datasheet_path': datasheet_path, 'source': 'scraped'}
                         if datasheet_path else None),
            })

        # STEP 3: Datasheet Parsing
        mechanical_diagram = None
        parsed_specs = None
        if datasheet_path:
            pdf_path_obj = Path(datasheet_path)
            if not pdf_path_obj.exists():
                raise FileNotFoundError(f"Datasheet PDF not found: {datasheet_path}")

            progress_queue.put({
                'type': 'step', 'step': 'parse', 'title': 'Extracting Parameters',
                'status': 'running',
                'message': 'Parsing datasheet and extracting mechanical diagrams...'
            })
            mechanical_diagram, parsed_specs = detector._parse_datasheet(
                str(pdf_path_obj.resolve()), result.part_number,
                result.package_type, result.pin_count, result.manufacturer
            )
            result.mechanical_diagram_path = mechanical_diagram
            result.parsed_specs = parsed_specs

            # Gemini extraction of dimensions from the mechanical diagram
            if mechanical_diagram and Path(mechanical_diagram).exists():
                try:
                    gemini_extracted_dims = detector._extract_dimensions_with_gemini(mechanical_diagram)
                    if gemini_extracted_dims:
                        if parsed_specs is None:
                            parsed_specs = {}
                        parsed_specs.setdefault('package_dimensions', {})
                        parsed_specs['package_dimensions'].update({
                            'body_length_mm': gemini_extracted_dims.get('body_length_mm'),
                            'body_width_mm': gemini_extracted_dims.get('body_width_mm'),
                            'length_mm': gemini_extracted_dims.get('body_length_mm'),
                            'width_mm': gemini_extracted_dims.get('body_width_mm'),
                            'height_mm': gemini_extracted_dims.get('height_mm'),
                            'pin_count': gemini_extracted_dims.get('pin_count'),
                            'pin_pitch_mm': gemini_extracted_dims.get('pin_pitch_mm'),
                            'package_type': gemini_extracted_dims.get('package_type'),
                        })
                        result.parsed_specs = parsed_specs
                except Exception as e:
                    print(f"[Runner] Gemini dimension extraction failed: {e}")

            progress_queue.put({
                'type': 'step', 'step': 'parse', 'title': 'Extracting Parameters',
                'status': 'completed',
                'message': 'Mechanical specifications extracted',
                'data': {
                    'mechanical_diagram': _rel_to_data(mechanical_diagram),
                    'datasheet_path': datasheet_path,
                    'parsed_specs': parsed_specs,
                    'package_dimensions': (parsed_specs or {}).get('package_dimensions', {}),
                }
            })

        # STEP 4: Pin Counter (YOLO) — GPU worker
        progress_queue.put({
            'type': 'step', 'step': 'pin_counter', 'title': 'Pin Count Check',
            'status': 'running', 'message': 'Counting pins with YOLO model...'
        })
        pin_counter_dict, pin_viz = detector._run_pin_counter(primary_image_path)
        result.pin_counter = pin_counter_dict
        result.pin_visualization = pin_viz
        progress_queue.put({
            'type': 'step', 'step': 'pin_counter', 'title': 'Pin Count Check',
            'status': 'completed',
            'message': f"Pins detected: {pin_counter_dict.get('pins_detected', 0)}",
            'visualization': _download_url(pin_viz),
            'data': pin_counter_dict,
        })

        # STEP 5: Dimension Analysis (CPU — runs on this host)
        progress_queue.put({
            'type': 'step', 'step': 'dimension', 'title': 'Dimension Analysis',
            'status': 'running', 'message': 'Measuring IC body dimensions...'
        })
        dimension_dict, dim_viz = detector._estimate_dimensions(cropped_image_path, result)
        result.dimension_analysis = dimension_dict
        result.dimension_visualization = dim_viz
        if dim_viz:
            viz_url = _download_url(dim_viz)
            measured_ar = dimension_dict.get("measured_aspect_ratio")
            message_ar = f'{measured_ar:.2f}' if isinstance(measured_ar, (int, float)) else 'N/A'
            progress_queue.put({
                'type': 'step', 'step': 'dimension', 'title': 'Dimension Analysis',
                'status': 'completed',
                'message': f'Dimensions: AR = {message_ar}',
                'visualization': viz_url,
                'sam_visualization': viz_url,
                'data': {**dimension_dict, 'sam_visualization': viz_url},
            })
        else:
            progress_queue.put({
                'type': 'step', 'step': 'dimension', 'title': 'Dimension Analysis',
                'status': 'completed', 'message': 'Dimension analysis complete'
            })

        # STEP 5.5: Histogram Filter Analysis — GPU worker
        progress_queue.put({
            'type': 'step', 'step': 'histogram_filter', 'title': 'Histogram Filter Analysis',
            'status': 'running',
            'message': 'Running image processing filters for defect detection...'
        })
        histogram_manifest, dashboard_path, strips = detector._run_histogram_filter(
            primary_image_path, result)
        result.histogram_analysis = histogram_manifest
        result.histogram_dashboard = dashboard_path
        result.histogram_strips = strips
        progress_queue.put({
            'type': 'step', 'step': 'histogram_filter', 'title': 'Histogram Filter Analysis',
            'status': 'completed',
            'message': 'Applied 11 image processing filters (CLAHE, Edge Map, Threshold, etc.)',
            'visualization': _download_url(dashboard_path),
            'data': {
                'dashboard_path': dashboard_path,
                'dashboard_url': _download_url(dashboard_path),
                'strip_paths': strips,
                'strip_urls': [u for u in (_download_url(s) for s in strips) if u],
                'analysis_json_path': (histogram_manifest or {}).get('analysis_json_path'),
            }
        })

        # STEP 6: Visual Analysis (Gemini) with annotation RAG context
        progress_queue.put({
            'type': 'step', 'step': 'visual', 'title': 'Visual Comparison',
            'status': 'running', 'message': 'Performing visual analysis'
        })
        similar_annotations = []
        try:
            from utils.vector_db import get_vector_db
            vector_db = get_vector_db()
            if vector_db:
                search_query = f"{result.part_number} {result.manufacturer} {result.package_type}"
                similar_annotations = vector_db.search_annotations(
                    query=search_query, limit=5,
                    filters={'correction_to_ai': True})
        except Exception as e:
            print(f"[Runner] Annotation lookup skipped: {e}")

        visual_result = detector._gemini_visual_analysis(
            primary_image_path, mechanical_diagram, parsed_specs, result,
            dimension_analysis=dimension_dict,
            datasheet_pdf_path=result.datasheet_path,
            all_images=image_paths,
            additional_info=additional_info,
            annotations=similar_annotations,
        )
        result.visual_comparison = visual_result
        result.anomalies = visual_result.get('anomalies', [])
        progress_queue.put({
            'type': 'step', 'step': 'visual', 'title': 'Visual Comparison',
            'status': 'completed',
            'message': f'Analysis complete: {len(result.anomalies)} anomalies detected',
            'data': {
                'anomalies_count': len(result.anomalies),
                'anomalies': result.anomalies,
                'visual_comparison': visual_result,
            }
        })

        # STEP 7: Final Verdict
        progress_queue.put({
            'type': 'step', 'step': 'verdict', 'title': 'Calculating Verdict',
            'status': 'running', 'message': 'Computing authenticity score...'
        })
        detector._calculate_verdict(result)
        progress_queue.put({
            'type': 'step', 'step': 'verdict', 'title': 'Calculating Verdict',
            'status': 'completed',
            'message': f'Verdict: {result.verdict} (Score: {result.authenticity_score:.1f}/100)',
            'data': {'verdict': result.verdict, 'score': result.authenticity_score},
        })

        # STEP 8: Report Generation
        progress_queue.put({
            'type': 'step', 'step': 'report', 'title': 'Generating Report',
            'status': 'running', 'message': 'Creating PDF report...'
        })
        report_path = detector._generate_report(result)
        result.report_path = report_path
        progress_queue.put({
            'type': 'step', 'step': 'report', 'title': 'Generating Report',
            'status': 'completed', 'message': 'PDF report generated',
            'data': {'report_path': _rel_to_data(report_path)},
        })

        result.processing_time_seconds = time.time() - start_time
        return result

    except Exception as e:
        error_msg = str(e)
        error_trace = traceback.format_exc()
        print(f"[Runner] Error in detect_with_progress: {error_msg}")
        print(error_trace)
        progress_queue.put({
            'type': 'error',
            'message': f'Detection failed: {error_msg}',
            'error_type': type(e).__name__,
            'traceback': error_trace[-500:],
        })
        error_result = DetectionResult(
            ic_image_path=str(all_image_paths[0]) if all_image_paths else 'unknown',
            timestamp=datetime.now().isoformat(),
            anomalies=[],
            verdict='ERROR',
            authenticity_score=0.0,
            reasoning=f'Error during detection: {error_msg}',
        )
        return error_result
