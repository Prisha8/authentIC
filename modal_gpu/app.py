"""Modal serverless GPU worker for authentIC ("authentic-gpu").

Hosts the three torch-bound pipeline stages so the 8GB home server never
needs torch installed:
  - preprocess : ultralytics SAM crop + EasyOCR text straightening
  - pin_count  : custom YOLO pin/notch detector
  - histogram  : 11 torchvision/opencv filters + matplotlib dashboard

One image, one @app.cls: a single warm T4 container serves all stages of a
detection, and scaledown_window keeps it alive across the laptop-side Gemini/
datasheet stages that run between preprocess and pin_count/histogram.

All weights are baked into the image at build time (no cold-start downloads):
  /weights/sam2.1_b.pt          ultralytics SAM 2.1 base (~155 MB, fetched at build)
  /weights/pin_counter.pt       repo-local custom YOLO (20 MB)
  /weights/easyocr_models/      repo-local EasyOCR craft + english_g2 (95 MB)

The actual stage logic is the repo's own backend/tools/gpu_stages.py, mounted
into the image, so local (RTX 4060) and Modal runs share one code path.

Deploy:  modal deploy modal_gpu/app.py
Smoke:   modal run modal_gpu/app.py --image-path backend/dataset/TestingData/Counterfeit/<img>.png
"""

import sys
import tempfile
from pathlib import Path

import modal

REPO_ROOT = Path(__file__).parent.parent
BACKEND_TOOLS = REPO_ROOT / "backend" / "tools"
WEIGHTS_DIR = REPO_ROOT / "backend" / "weights"

ULTRALYTICS_SAM_URL = (
    "https://github.com/ultralytics/assets/releases/download/v8.3.0/sam2.1_b.pt"
)

app = modal.App("authentic-gpu")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libgl1", "libglib2.0-0", "wget")
    .pip_install("uv")
    .run_commands(
        "uv pip install --system torch torchvision --index-url https://download.pytorch.org/whl/cu124",
        "uv pip install --system 'ultralytics>=8.3' 'easyocr>=1.7.1' "
        "opencv-python-headless matplotlib numpy pillow",
        f"mkdir -p /weights && wget -q -O /weights/sam2.1_b.pt {ULTRALYTICS_SAM_URL}",
    )
    .env({
        "MPLBACKEND": "Agg",
        "SAM_MODEL_PATH": "/weights/sam2.1_b.pt",
        "PIN_COUNTER_WEIGHTS_PATH": "/weights/pin_counter.pt",
        "EASYOCR_MODEL_DIR": "/weights/easyocr_models",
        "EASYOCR_GPU": "true",
        "YOLO_CONFIG_DIR": "/tmp/ultralytics",
    })
    .add_local_file(WEIGHTS_DIR / "pin_counter.pt", "/weights/pin_counter.pt")
    .add_local_dir(WEIGHTS_DIR / "easyocr_models", "/weights/easyocr_models")
    .add_local_dir(
        BACKEND_TOOLS,
        "/repo/backend/tools",
        ignore=["**/__pycache__/**", "pipeline 2/output/**", "OCR+datasheet_scraper/**"],
    )
)


@app.cls(
    image=image,
    gpu="T4",
    memory=8192,
    timeout=600,
    scaledown_window=240,
)
class GPUWorker:

    @modal.enter()
    def load_models(self):
        """Load all models once per container (cold start ~30-60s, then warm)."""
        sys.path.insert(0, "/repo/backend")
        import os
        import tools.gpu_stages as gs

        # Preprocessing module: SAM + EasyOCR readers are cached inside it
        gs._PREPROCESSING_MODULE = gs._load_preprocessing_module()
        gs._PREPROCESSING_MODULE._get_sam_model(os.environ["SAM_MODEL_PATH"])
        gs._PREPROCESSING_MODULE._get_easyocr_reader()

        # YOLO pin counter
        from tools.pin_counter import _load_model
        _load_model(Path(os.environ["PIN_COUNTER_WEIGHTS_PATH"]))

        self.gs = gs
        print("[GPUWorker] models loaded")

    def _run_stage(self, stage_fn, image_bytes: bytes, **kwargs) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            image_path = tmp_path / "input.png"
            image_path.write_bytes(image_bytes)
            out_dir = tmp_path / "out"
            out_dir.mkdir()
            result = stage_fn(str(image_path), str(out_dir), **kwargs)
            artifacts = self.gs.collect_artifacts(str(out_dir))
            return {"result": result, "artifacts": artifacts}

    @modal.method()
    def preprocess(self, image_bytes: bytes) -> dict:
        return self._run_stage(self.gs.run_preprocess_stage, image_bytes)

    @modal.method()
    def pin_count(self, image_bytes: bytes) -> dict:
        return self._run_stage(self.gs.run_pin_stage, image_bytes)

    @modal.method()
    def histogram(self, image_bytes: bytes) -> dict:
        return self._run_stage(self.gs.run_histogram_stage, image_bytes)

    @modal.method()
    def ping(self) -> str:
        import torch
        return f"ok cuda={torch.cuda.is_available()}"


@app.local_entrypoint()
def main(image_path: str = ""):
    """Smoke test: run all three stages against one local image."""
    worker = GPUWorker()
    print("ping:", worker.ping.remote())
    if not image_path:
        return
    data = Path(image_path).read_bytes()
    for name in ("preprocess", "pin_count", "histogram"):
        payload = getattr(worker, name).remote(data)
        print(f"{name}: result={payload['result']}")
        print(f"{name}: {len(payload['artifacts'])} artifacts "
              f"({sum(len(v) for v in payload['artifacts'].values()) // 1024} KB)")
