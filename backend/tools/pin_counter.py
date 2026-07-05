#!/usr/bin/env python3
"""
Lightweight pin counter using an Ultralytics YOLO checkpoint.

Purpose:
    - Run a local YOLO model that was trained to detect IC pins/notches.
    - Produce a visualization image highlighting detections.
    - Return structured counts for downstream storage/preview (no Gemini use).

Defaults:
    - Weights path can be provided explicitly or via the PIN_COUNTER_WEIGHTS_PATH
      environment variable. Default location: backend/weights/pin_counter.pt
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
        "ultralytics is required for pin counting. Install with `pip install ultralytics`."
    ) from exc


@dataclass
class PinDetection:
    cls_name: str
    confidence: float
    bbox: Tuple[float, float, float, float]  # x1, y1, x2, y2
    classification: str = "suspicious"  # "authentic", "suspicious", or "counterfeit"


@dataclass
class PinCounterResult:
    pins_detected: int
    notches_detected: int
    total_detections: int
    class_counts: Dict[str, int]
    detections: List[PinDetection]
    visualization_path: Optional[str] = None
    source_image: Optional[str] = None
    classification_stats: Optional[Dict[str, int]] = None  # Counts by classification

    def to_dict(self) -> Dict:
        data = asdict(self)
        # Convert dataclass objects inside the list to dicts for JSON safety
        data["detections"] = [asdict(det) for det in self.detections]
        return data


_MODEL_CACHE: Dict[str, YOLO] = {}


def _load_model(weights_path: Path) -> YOLO:
    if not weights_path.exists():
        raise FileNotFoundError(
            f"Pin counter weights not found at: {weights_path}. "
            "Set PIN_COUNTER_WEIGHTS_PATH or pass weights_path explicitly."
        )
    key = str(weights_path.resolve())
    if key not in _MODEL_CACHE:
        _MODEL_CACHE[key] = YOLO(key)
    return _MODEL_CACHE[key]


def _build_overlay(result, pin_count: int, notch_count: int, detections: List[PinDetection]) -> np.ndarray:
    """Overlay counts on the plotted detections with classification colors."""
    overlay = result.plot(labels=True, conf=True)  # BGR ndarray
    
    # Draw classification-colored boxes for filtered detections
    for det in detections:
        if det.cls_name == "pins":  # Only highlight pins, not notches
            x1, y1, x2, y2 = map(int, det.bbox)
            # Color based on classification
            if det.classification == "authentic":
                color = (0, 255, 0)  # Green
            elif det.classification == "suspicious":
                color = (0, 165, 255)  # Orange
            else:  # counterfeit
                color = (0, 0, 255)  # Red
            # Draw thicker border
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 3)
    
    header = f"Pins: {pin_count} | Notches: {notch_count}"
    cv2.putText(
        overlay,
        header,
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (0, 255, 0),
        2,
        cv2.LINE_AA,
    )
    return overlay


def run_pin_counter(
    image_path: str,
    weights_path: Optional[str],
    output_dir: str,
    conf: float = 0.25,
    imgsz: int = 640,
) -> PinCounterResult:
    """
    Run YOLO-based pin counting on a single image.

    Args:
        image_path: Path to the IC image.
        weights_path: Path to YOLO checkpoint (.pt).
        output_dir: Directory to store visualization.
        conf: Confidence threshold.
        imgsz: Inference image size.
    """
    image_path_obj = Path(image_path)
    weights_path_obj = Path(weights_path).expanduser() if weights_path else None
    if weights_path_obj is None:
        raise ValueError("weights_path must be provided for pin counting.")

    model = _load_model(weights_path_obj)

    results = model.predict(
        source=str(image_path_obj),
        conf=conf,
        imgsz=imgsz,
        save=False,
        verbose=False,
    )
    result = results[0]

    names = result.names
    class_counts: Dict[str, int] = {}
    all_detections: List[PinDetection] = []
    filtered_detections: List[PinDetection] = []
    classification_stats: Dict[str, int] = {"authentic": 0, "suspicious": 0, "counterfeit": 0}

    # First pass: collect all detections and classify them
    for box in result.boxes:
        cls_idx = int(box.cls[0])
        cls_name = names.get(cls_idx, str(cls_idx))
        bbox = tuple(map(float, box.xyxy[0].tolist()))
        confidence = float(box.conf[0])
        
        # Classify based on confidence
        if confidence >= 0.8:
            classification = "authentic"
        elif confidence >= 0.5:
            classification = "suspicious"
        else:
            classification = "counterfeit"
        
        detection = PinDetection(
            cls_name=cls_name,
            confidence=confidence,
            bbox=bbox,
            classification=classification
        )
        all_detections.append(detection)
        
        # Filter: only include detections with confidence > 0.5
        if confidence > 0.5:
            filtered_detections.append(detection)
            class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
            if cls_name == "pins":
                classification_stats[classification] = classification_stats.get(classification, 0) + 1

    # Count only filtered detections
    pins_detected = sum(1 for d in filtered_detections if d.cls_name == "pins")
    notches_detected = sum(1 for d in filtered_detections if d.cls_name == "notch")

    # Build visualization with filtered detections highlighted
    output_dir_path = Path(output_dir) / "pin_counter"
    output_dir_path.mkdir(parents=True, exist_ok=True)
    overlay = _build_overlay(result, pins_detected, notches_detected, filtered_detections)
    viz_path = output_dir_path / f"pin_count_{image_path_obj.stem}.png"
    cv2.imwrite(str(viz_path), overlay)

    return PinCounterResult(
        pins_detected=pins_detected,
        notches_detected=notches_detected,
        total_detections=len(filtered_detections),  # Only count filtered
        class_counts=class_counts,
        detections=filtered_detections,  # Only return filtered detections
        visualization_path=str(viz_path),
        source_image=str(image_path_obj),
        classification_stats=classification_stats,
    )


