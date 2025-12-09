#!/usr/bin/env python3
"""
YOLOv11-based detector to locate ICs mounted on FPGA/PCB images.

Given a board-level photo, this tool finds IC bounding boxes, saves cropped
regions, and writes an overlay for quick visualization. The crops can be fed
into the downstream counterfeit detection pipeline.
"""

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

try:
    from ultralytics import YOLO
except ImportError as exc:  # pragma: no cover - dependency guard
    raise ImportError(
        "ultralytics is required for PCB IC detection. Install with `pip install ultralytics`."
    ) from exc


@dataclass
class PCBCrop:
    """Detected IC crop metadata."""

    bbox: Tuple[float, float, float, float]
    confidence: float
    class_name: str
    crop_path: str
    source_image: str

    def to_dict(self) -> Dict:
        return asdict(self)


def _load_model(weights_path: Path) -> YOLO:
    if not weights_path.exists():
        raise FileNotFoundError(
            f"PCB detector weights not found at: {weights_path}. "
            "Set PCB_WEIGHTS_PATH or place pcb_weights.pt in backend/weights."
        )
    return YOLO(str(weights_path))


def _prepare_output_dirs(base_dir: Path) -> Tuple[Path, Path]:
    crops_dir = base_dir / "pcb_crops"
    overlay_dir = base_dir / "pcb_detection"
    crops_dir.mkdir(parents=True, exist_ok=True)
    overlay_dir.mkdir(parents=True, exist_ok=True)
    return crops_dir, overlay_dir


def detect_pcb_ics(
    image_path: str,
    weights_path: str,
    output_dir: str,
    conf: float = 0.35,
    imgsz: int = 1280,
    max_det: int = 12,
) -> Dict:
    """
    Detect ICs on a PCB/FPGA image, save crops, and return metadata.

    Returns:
        {
            "crops": [PCBCrop.to_dict(), ...],
            "overlay_path": str | None
        }
    """
    image_path_obj = Path(image_path)
    if not image_path_obj.exists():
        raise FileNotFoundError(f"Input image not found: {image_path}")

    weights_path_obj = Path(weights_path).expanduser()
    model = _load_model(weights_path_obj)

    crops_dir, overlay_dir = _prepare_output_dirs(Path(output_dir))

    # Run YOLO inference
    results = model.predict(
        source=str(image_path_obj),
        conf=conf,
        imgsz=imgsz,
        max_det=max_det,
        save=False,
        verbose=False,
    )
    result = results[0]

    # Keep the original image for cropping
    image_bgr = cv2.imread(str(image_path_obj))
    if image_bgr is None:
        raise ValueError(f"Failed to read image for cropping: {image_path}")

    detections: List[PCBCrop] = []
    for idx, box in enumerate(result.boxes):
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        crop = image_bgr[int(y1) : int(y2), int(x1) : int(x2)]
        crop_path = crops_dir / f"{image_path_obj.stem}_pcb_{idx+1}.png"
        cv2.imwrite(str(crop_path), crop)

        cls_idx = int(box.cls[0])
        cls_name = result.names.get(cls_idx, str(cls_idx))
        conf_score = float(box.conf[0])

        detections.append(
            PCBCrop(
                bbox=(float(x1), float(y1), float(x2), float(y2)),
                confidence=conf_score,
                class_name=cls_name,
                crop_path=str(crop_path),
                source_image=str(image_path_obj),
            )
        )

    # Save overlay for quick preview
    overlay_bgr = result.plot(labels=True, conf=True)
    overlay_path = overlay_dir / f"{image_path_obj.stem}_pcb_overlay.png"
    cv2.imwrite(str(overlay_path), overlay_bgr)

    return {
        "crops": [det.to_dict() for det in detections],
        "overlay_path": str(overlay_path),
    }


