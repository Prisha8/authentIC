#!/usr/bin/env python3
"""
GPU-bound pipeline stages with a uniform, directory-based contract.

These are the only stages that require torch (SAM segmentation + EasyOCR
preprocessing, YOLO pin counting, torchvision histogram filters). They are
called either:
  - in-process on a GPU dev box (LocalGPUClient), or
  - inside a Modal serverless container (modal_gpu/app.py), which shuttles the
    image in as bytes and the produced artifact files back out as bytes.

Contract for every stage function:
  - Inputs: an image path plus an output directory.
  - All artifacts are written under ``output_dir``.
  - The returned dict contains file paths RELATIVE to ``output_dir`` (posix
    separators) so the result JSON is portable across hosts. Callers rebase
    them onto their local filesystem.
"""

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


def _rel(path_value, base: Path):
    """Convert a path under base to a posix relative string (None-safe)."""
    if not path_value:
        return None
    p = Path(path_value)
    try:
        return p.resolve().relative_to(Path(base).resolve()).as_posix()
    except ValueError:
        return p.name


def _relativize_obj(obj, base: Path):
    """Recursively rewrite absolute path strings under ``base`` to relative."""
    base_resolved = str(Path(base).resolve())
    if isinstance(obj, dict):
        return {k: _relativize_obj(v, base) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_relativize_obj(v, base) for v in obj]
    if isinstance(obj, str) and obj.startswith(base_resolved):
        return Path(obj).resolve().relative_to(Path(base).resolve()).as_posix()
    return obj


def _load_preprocessing_module():
    """Import backend/tools/pipeline 2/pipeline.py (dir name has a space)."""
    pipeline_path = Path(__file__).parent / "pipeline 2" / "pipeline.py"
    spec = importlib.util.spec_from_file_location("preprocessing_pipeline", pipeline_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_PREPROCESSING_MODULE = None


def run_preprocess_stage(image_path: str, output_dir: str,
                         sam_model_path: Optional[str] = None) -> Dict:
    """SAM crop + EasyOCR text straightening (Stage 0)."""
    global _PREPROCESSING_MODULE
    if _PREPROCESSING_MODULE is None:
        _PREPROCESSING_MODULE = _load_preprocessing_module()

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    sam_model_path = (
        sam_model_path
        or os.getenv("SAM_MODEL_PATH")
        or str(_BACKEND_DIR / "weights" / "sam2.1_b.pt")
    )

    result = _PREPROCESSING_MODULE.run_pipeline(
        image_path=str(image_path),
        output_dir=str(out_dir),
        sam_model_path=sam_model_path,
    )
    if not result:
        raise RuntimeError("Preprocessing failed - could not crop IC")

    return {
        "output_ic_crop": _rel(result.get("output_ic_crop"), out_dir),
        "output_textbox_viz": _rel(result.get("output_textbox_viz"), out_dir),
        "output_0_deg": _rel(result.get("output_0_deg"), out_dir),
        "output_180_deg": _rel(result.get("output_180_deg"), out_dir),
    }


def run_pin_stage(image_path: str, output_dir: str,
                  weights_path: Optional[str] = None) -> Dict:
    """YOLO pin/notch counting (writes pin_counter/pin_count_<stem>.png)."""
    from tools.pin_counter import run_pin_counter

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    weights_path = (
        weights_path
        or os.getenv("PIN_COUNTER_WEIGHTS_PATH")
        or str(_BACKEND_DIR / "weights" / "pin_counter.pt")
    )

    pin_result = run_pin_counter(
        image_path=str(image_path),
        weights_path=str(weights_path),
        output_dir=str(out_dir),
        conf=0.25,
        imgsz=640,
    )
    pin_dict = pin_result.to_dict()
    return {
        "pin_dict": _relativize_obj(pin_dict, out_dir),
        "visualization": _rel(pin_result.visualization_path, out_dir),
    }


def run_histogram_stage(image_path: str, output_dir: str) -> Dict:
    """11-filter histogram pipeline + dashboard + stats JSON.

    Writes into ``output_dir``/histogram_analysis (mirrors the layout the
    desktop pipeline used so the frontend and history manager stay compatible).
    """
    from tools.histogram_filter_tool import run_histogram_pipeline
    from tools.create_histogram_dashboard import create_histogram_dashboard
    from tools.analyze_histogram_stats import generate_histogram_analysis_json

    out_dir = Path(output_dir)
    histogram_dir = out_dir / "histogram_analysis"
    histogram_dir.mkdir(parents=True, exist_ok=True)

    manifest = run_histogram_pipeline(
        input_path=str(image_path),
        output_dir=str(histogram_dir),
        show=False,
    )

    manifest_path = histogram_dir / "histogram_manifest.json"
    dashboard_path = create_histogram_dashboard(str(manifest_path))
    analysis_json_path = generate_histogram_analysis_json(str(manifest_path))

    strips: List[str] = []
    for step in manifest.get("steps", []):
        strip_path = step.get("strip_image")
        if strip_path and Path(strip_path).exists():
            strips.append(strip_path)

    manifest["dashboard_path"] = dashboard_path
    manifest["analysis_json_path"] = analysis_json_path
    manifest["strip_paths"] = strips

    return {
        "manifest": _relativize_obj(manifest, out_dir),
        "dashboard": _rel(dashboard_path, out_dir),
        "strips": [_rel(s, out_dir) for s in strips],
    }


def collect_artifacts(output_dir: str) -> Dict[str, bytes]:
    """Read every file under output_dir into {relative_posix_path: bytes}.

    Used by the Modal worker to ship produced artifacts back to the caller.
    """
    out_dir = Path(output_dir)
    artifacts: Dict[str, bytes] = {}
    for p in sorted(out_dir.rglob("*")):
        if p.is_file():
            artifacts[p.relative_to(out_dir).as_posix()] = p.read_bytes()
    return artifacts


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run a single GPU stage (debug helper)")
    parser.add_argument("stage", choices=["preprocess", "pin", "histogram"])
    parser.add_argument("image_path")
    parser.add_argument("--output-dir", default="./gpu_stage_output")
    args = parser.parse_args()

    fn = {
        "preprocess": run_preprocess_stage,
        "pin": run_pin_stage,
        "histogram": run_histogram_stage,
    }[args.stage]
    print(json.dumps(fn(args.image_path, args.output_dir), indent=2))
