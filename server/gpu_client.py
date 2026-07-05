"""GPU stage clients: same interface, two transports.

- LocalGPUClient: runs backend/tools/gpu_stages.py in-process (needs torch +
  weights locally; used on the RTX 4060 dev box with GPU_BACKEND=local).
- ModalGPUClient: calls the deployed Modal app (GPU_BACKEND=modal, production).
  Images travel as bytes; produced artifact files come back as bytes and are
  written into the requested local output directory, so downstream code sees
  the exact same filesystem layout in both modes.

Every method takes (image_path, output_dir) and returns the stage's result
dict with paths rebased to absolute local paths under output_dir.
"""

from pathlib import Path
from typing import Dict, Optional

from server import config


def _absolutize(obj, base: Path):
    """Inverse of gpu_stages._relativize_obj for the known path-bearing keys.

    Stage results contain posix-relative path strings. We rebase any string
    value that resolves to an existing file under ``base``.
    """
    if isinstance(obj, dict):
        return {k: _absolutize(v, base) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_absolutize(v, base) for v in obj]
    if isinstance(obj, str):
        candidate = base / obj
        if not Path(obj).is_absolute() and candidate.exists():
            return str(candidate.resolve())
    return obj


class LocalGPUClient:
    """In-process execution on a machine that has torch + weights."""

    def preprocess(self, image_path: str, output_dir: Path) -> Dict:
        from tools.gpu_stages import run_preprocess_stage
        result = run_preprocess_stage(str(image_path), str(output_dir))
        return _absolutize(result, Path(output_dir))

    def pin_count(self, image_path: str, output_dir: Path) -> Dict:
        from tools.gpu_stages import run_pin_stage
        result = run_pin_stage(str(image_path), str(output_dir),
                               weights_path=config.PIN_COUNTER_WEIGHTS_PATH)
        return _absolutize(result, Path(output_dir))

    def histogram(self, image_path: str, output_dir: Path) -> Dict:
        from tools.gpu_stages import run_histogram_stage
        result = run_histogram_stage(str(image_path), str(output_dir))
        return _absolutize(result, Path(output_dir))


class ModalGPUClient:
    """Remote execution on the deployed Modal app ("authentic-gpu")."""

    def __init__(self, app_name: Optional[str] = None):
        import modal
        cls = modal.Cls.from_name(app_name or config.MODAL_APP_NAME, "GPUWorker")
        self._worker = cls()

    @staticmethod
    def _unpack(payload: Dict, output_dir: Path) -> Dict:
        """Write returned artifact bytes under output_dir, absolutize result."""
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        for rel, data in payload.get("artifacts", {}).items():
            rel_path = Path(rel)
            if rel_path.is_absolute() or ".." in rel_path.parts:
                raise ValueError(f"Suspicious artifact path from GPU worker: {rel}")
            dest = output_dir / rel_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        return _absolutize(payload["result"], output_dir)

    @staticmethod
    def _call(method, data: bytes) -> Dict:
        # spawn + bounded get: a dropped connection must not hang the detection
        # thread (which holds the single live-analysis semaphore) forever.
        # 600s covers cold start + model load + inference comfortably.
        return method.spawn(data).get(timeout=600)

    def preprocess(self, image_path: str, output_dir: Path) -> Dict:
        payload = self._call(self._worker.preprocess, Path(image_path).read_bytes())
        return self._unpack(payload, output_dir)

    def pin_count(self, image_path: str, output_dir: Path) -> Dict:
        payload = self._call(self._worker.pin_count, Path(image_path).read_bytes())
        return self._unpack(payload, output_dir)

    def histogram(self, image_path: str, output_dir: Path) -> Dict:
        payload = self._call(self._worker.histogram, Path(image_path).read_bytes())
        return self._unpack(payload, output_dir)


_CLIENT = None


def get_gpu_client():
    global _CLIENT
    if _CLIENT is None:
        if config.GPU_BACKEND == "local":
            _CLIENT = LocalGPUClient()
        else:
            _CLIENT = ModalGPUClient()
    return _CLIENT
