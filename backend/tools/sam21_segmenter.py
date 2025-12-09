#!/usr/bin/env python3
"""
SAM 2.1 wrapper to produce IC body masks.

The loader is cached so we only instantiate the predictor once per process.
If SAM 2.1 is unavailable, callers should catch Sam21NotAvailable and fall
back to alternative detection.
"""

from __future__ import annotations

from functools import lru_cache
from importlib.resources import files
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
from PIL import Image


class Sam21NotAvailable(RuntimeError):
    """Raised when the SAM 2.1 model or dependencies cannot be loaded."""


def _default_model_cfg() -> Optional[str]:
    """
    Return a default SAM 2.1 config reference.

    The pip package ships Hydra configs referenced by name, not absolute path,
    so we default to the known hi-era B+ config string which works with
    build_sam2(config_file=...).
    """
    return "configs/sam2.1/sam2.1_hiera_b+"


@lru_cache(maxsize=2)
def _load_predictor(
    checkpoint_path: str,
    model_cfg: Optional[str] = None,
    device: Optional[str] = None,
):
    """
    Lazily load the SAM 2.1 predictor.

    Args:
        checkpoint_path: Path to the .pt weights.
        model_cfg: Optional path to the YAML config. If not provided, tries the
                   packaged base config.
        device: Optional device string. Defaults to CUDA if available.
    """
    try:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except Exception as exc:  # noqa: BLE001
        raise Sam21NotAvailable(
            "SAM 2.1 is not available. Install with `pip install sam2`."
        ) from exc

    resolved_ckpt = str(Path(checkpoint_path).expanduser())
    if not Path(resolved_ckpt).exists():
        raise Sam21NotAvailable(f"SAM 2.1 checkpoint not found at: {resolved_ckpt}")

    resolved_cfg = model_cfg or _default_model_cfg()
    if resolved_cfg is None:
        raise Sam21NotAvailable(
            "SAM 2.1 config could not be found. Provide `model_cfg` explicitly."
        )

    device_to_use = device or ("cuda" if torch.cuda.is_available() else "cpu")
    sam_model = build_sam2(
        config_file=resolved_cfg,
        ckpt_path=resolved_ckpt,
        device=device_to_use,
    )
    predictor = SAM2ImagePredictor(sam_model)
    return predictor, device_to_use, resolved_cfg


def _normalize_masks(masks: Any) -> np.ndarray:
    """Convert predictor masks to (N, H, W) uint8 array."""
    masks_np = np.array(masks)
    if masks_np.ndim == 4:
        # (N, 1, H, W)
        masks_np = masks_np[:, 0]
    if masks_np.ndim != 3:
        raise Sam21NotAvailable(f"Unexpected mask shape from SAM 2.1: {masks_np.shape}")
    return masks_np.astype(np.uint8)


def generate_sam21_mask(
    image_path: str,
    checkpoint_path: str,
    model_cfg: Optional[str] = None,
    device: Optional[str] = None,
    box_prompt: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Generate a foreground mask for the IC body using SAM 2.1.

    Args:
        image_path: Path to the RGB image.
        checkpoint_path: Path to the SAM 2.1 weights (.pt).
        model_cfg: Optional YAML config path.
        device: Device override.
        box_prompt: Optional box prompt (x0, y0, x1, y1) np.ndarray.

    Returns:
        mask: Binary uint8 mask (H, W) where 1 indicates the IC body.
        meta: Dict with score, coverage, and loader metadata.
    """
    try:
        predictor, used_device, used_cfg = _load_predictor(
            checkpoint_path=checkpoint_path,
            model_cfg=model_cfg,
            device=device,
        )
    except Sam21NotAvailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise Sam21NotAvailable(f"SAM 2.1 predictor failed to load: {exc}") from exc

    image = Image.open(image_path).convert("RGB")
    np_img = np.array(image)
    height, width = np_img.shape[:2]
    predictor.set_image(np_img)

    box = box_prompt
    if box is None:
        # Use full-frame box to encourage a dominant foreground mask
        box = np.array([[0, 0, width - 1, height - 1]], dtype=np.float32)

    try:
        masks, scores, _ = predictor.predict(box=box, multimask_output=True)
    except Exception as exc:  # noqa: BLE001
        raise Sam21NotAvailable(f"SAM 2.1 inference failed: {exc}") from exc

    masks_np = _normalize_masks(masks)
    if masks_np.size == 0:
        raise Sam21NotAvailable("SAM 2.1 returned no masks.")

    scores_np = np.array(scores) if scores is not None else np.zeros(masks_np.shape[0])
    areas = masks_np.reshape(masks_np.shape[0], -1).sum(axis=1)

    # Rank masks by score first, then area
    if scores_np.size and not np.isnan(scores_np).all():
        rank_scores = scores_np + 1e-6 * (areas / (areas.max() or 1))
    else:
        rank_scores = areas

    best_idx = int(np.argmax(rank_scores))
    best_mask = masks_np[best_idx]
    best_score = float(scores_np[best_idx]) if scores_np.size else None
    best_area = int(areas[best_idx])
    coverage = float(best_area) / float(height * width)

    meta: Dict[str, Any] = {
        "score": best_score,
        "area_px": best_area,
        "coverage": coverage,
        "device": used_device,
        "model_cfg": used_cfg,
        "checkpoint": str(Path(checkpoint_path).expanduser()),
    }

    return best_mask.astype(np.uint8), meta


__all__ = ["generate_sam21_mask", "Sam21NotAvailable"]

