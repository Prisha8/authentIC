#!/usr/bin/env python3
"""
Histogram + filter visualization helper for Gemini

This utility applies a configurable image-processing pipeline (resize, grayscale,
gamma correction, histogram equalization, CLAHE, blur, edge map, noise, Otsu
thresholding, normalization) and produces 4-panel strips:
1) Root/original image
2) Immediate input to the filter
3) Filter output
4) Histogram of the output

Outputs are saved to disk so Gemini can inspect both the processed images and
their histograms when reasoning about surface defects.
"""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple, Union

import cv2
import matplotlib

# Headless-safe backend
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import torchvision.transforms as T
import torchvision.transforms.functional as F
from PIL import Image, ImageFilter

ImageLike = Union[Image.Image, torch.Tensor, np.ndarray]


@dataclass
class PipelineOptions:
    """Tunable parameters for the visualization pipeline."""

    target_size: Tuple[int, int] = (512, 512)
    gamma: float = 0.6
    clahe_clip: float = 2.0
    clahe_grid: Tuple[int, int] = (8, 8)
    noise_std: float = 0.1
    blur_kernel: Tuple[int, int] = (5, 9)
    blur_sigma: Tuple[float, float] = (0.1, 5.0)


@dataclass
class PipelineStep:
    """Single processing step with metadata for manifest."""

    name: str
    transform: Callable[[ImageLike], ImageLike]
    description: str


def _ensure_dir(path: Union[str, Path]) -> Path:
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _to_pil(img: ImageLike) -> Image.Image:
    """Convert supported inputs (PIL/np/tensor) to PIL for visualization."""
    if isinstance(img, Image.Image):
        return img
    if isinstance(img, np.ndarray):
        if img.ndim == 2:
            return Image.fromarray(img.astype(np.uint8))
        if img.shape[2] == 3:
            return Image.fromarray(img.astype(np.uint8))
        raise ValueError("NumPy array must have 1 or 3 channels")
    if isinstance(img, torch.Tensor):
        tensor = img.detach().cpu()
        if tensor.min() < 0:
            tensor = (tensor * 0.5) + 0.5
        tensor = torch.clamp(tensor, 0.0, 1.0)
        return T.ToPILImage()(tensor)
    raise TypeError(f"Unsupported image type: {type(img)}")


def _calc_histogram(pil_img: Image.Image) -> List[Tuple[str, np.ndarray]]:
    """Return per-channel histograms."""
    arr = np.array(pil_img)
    histograms: List[Tuple[str, np.ndarray]] = []
    if arr.ndim == 3:
        for idx, color in enumerate(("r", "g", "b")):
            hist = cv2.calcHist([arr], [idx], None, [256], [0, 256])
            histograms.append((color, hist))
    else:
        hist = cv2.calcHist([arr], [0], None, [256], [0, 256])
        histograms.append(("k", hist))
    return histograms


def _render_strip(
    step_name: str,
    original_pil: Image.Image,
    before_pil: Image.Image,
    after_pil: Image.Image,
    hist_data: List[Tuple[str, np.ndarray]],
    output_dir: Path,
    show: bool = False,
) -> str:
    """Create and save 4-panel strip (original, before, after, histogram)."""
    fig, axes = plt.subplots(1, 4, figsize=(24, 6))

    axes[0].imshow(original_pil)
    axes[0].set_title("1. Original (Root)")
    axes[0].axis("off")

    axes[1].imshow(before_pil)
    axes[1].set_title(f"2. Before Filter\n(Input to {step_name})")
    axes[1].axis("off")

    axes[2].imshow(after_pil)
    axes[2].set_title(f"3. After Filter\n(Output of {step_name})")
    axes[2].axis("off")

    for color, hist in hist_data:
        axes[3].plot(hist, color=color, alpha=0.7, label=color)
    if len(hist_data) > 1:
        axes[3].legend()
    axes[3].set_title(f"4. Histogram\n({step_name})")
    axes[3].set_xlim([0, 256])
    axes[3].grid(True, alpha=0.3)

    plt.tight_layout()

    plot_path = output_dir / f"{step_name}_strip.png"
    fig.savefig(plot_path)
    if show:
        plt.show()
    plt.close(fig)
    return str(plot_path)


def _apply_resize(options: PipelineOptions) -> Callable[[ImageLike], ImageLike]:
    resize = T.Resize(options.target_size)
    return lambda img: resize(_to_pil(img))


def _apply_grayscale() -> Callable[[ImageLike], ImageLike]:
    to_gray = T.Grayscale(num_output_channels=1)
    return lambda img: to_gray(_to_pil(img))


def _apply_gamma(options: PipelineOptions) -> Callable[[ImageLike], ImageLike]:
    return lambda img: F.adjust_gamma(_to_pil(img), gamma=options.gamma)


def _apply_hist_equalization() -> Callable[[ImageLike], ImageLike]:
    return lambda img: F.equalize(_to_pil(img))


def _apply_clahe(options: PipelineOptions) -> Callable[[ImageLike], ImageLike]:
    def transform(img: ImageLike) -> Image.Image:
        gray = _to_pil(img).convert("L")
        arr = np.array(gray)
        clahe = cv2.createCLAHE(
            clipLimit=options.clahe_clip, tileGridSize=options.clahe_grid
        )
        enhanced = clahe.apply(arr)
        return Image.fromarray(enhanced)

    return transform


def _apply_blur(options: PipelineOptions) -> Callable[[ImageLike], ImageLike]:
    blur = T.GaussianBlur(kernel_size=options.blur_kernel, sigma=options.blur_sigma)
    return lambda img: blur(_to_pil(img))


def _apply_edge_map() -> Callable[[ImageLike], ImageLike]:
    return lambda img: _to_pil(img).filter(ImageFilter.FIND_EDGES)


def _apply_color_jitter() -> Callable[[ImageLike], ImageLike]:
    jitter = T.ColorJitter(brightness=0.3, contrast=0.4, saturation=0.5, hue=0.2)
    return lambda img: jitter(_to_pil(img).convert("RGB"))


def _apply_noise(options: PipelineOptions) -> Callable[[ImageLike], ImageLike]:
    def transform(img: ImageLike) -> torch.Tensor:
        tensor = img if isinstance(img, torch.Tensor) else T.ToTensor()(_to_pil(img))
        noisy = tensor + torch.randn_like(tensor) * options.noise_std
        return torch.clamp(noisy, 0.0, 1.0)

    return transform


def _apply_threshold() -> Callable[[ImageLike], ImageLike]:
    def transform(img: ImageLike) -> Image.Image:
        gray = _to_pil(img).convert("L")
        arr = np.array(gray)
        _, thresh = cv2.threshold(arr, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return Image.fromarray(thresh)

    return transform


def _apply_normalize(mean: Optional[List[float]] = None, std: Optional[List[float]] = None):
    mean = mean or [0.5]
    std = std or [0.5]

    def transform(img: ImageLike) -> torch.Tensor:
        tensor = img if isinstance(img, torch.Tensor) else T.ToTensor()(_to_pil(img))
        norm = T.Normalize(mean=mean, std=std)
        return norm(tensor)

    return transform


def build_default_pipeline(options: PipelineOptions) -> List[PipelineStep]:
    """Recommended sequence mirroring the notebook."""
    return [
        PipelineStep(
            name="01_resize",
            transform=_apply_resize(options),
            description="Standardize resolution for downstream filters",
        ),
        PipelineStep(
            name="02_grayscale",
            transform=_apply_grayscale(),
            description="Single-channel conversion to focus on luminance",
        ),
        PipelineStep(
            name="03_gamma",
            transform=_apply_gamma(options),
            description="Gamma correction to lift dark epoxy regions",
        ),
        PipelineStep(
            name="04_hist_equalization",
            transform=_apply_hist_equalization(),
            description="Global histogram equalization for contrast stretching",
        ),
        PipelineStep(
            name="05_clahe",
            transform=_apply_clahe(options),
            description="Adaptive local contrast (CLAHE) to expose micro defects",
        ),
        PipelineStep(
            name="06_gaussian_blur",
            transform=_apply_blur(options),
            description="Gaussian blur to smooth noise before edge detection",
        ),
        PipelineStep(
            name="07_edge_map",
            transform=_apply_edge_map(),
            description="Edge map to highlight cracks and package boundaries",
        ),
        PipelineStep(
            name="08_color_jitter",
            transform=_apply_color_jitter(),
            description="Illumination/color perturbation for robustness checks",
        ),
        PipelineStep(
            name="09_gaussian_noise",
            transform=_apply_noise(options),
            description="Additive Gaussian noise to test model resilience",
        ),
        PipelineStep(
            name="10_otsu_threshold",
            transform=_apply_threshold(),
            description="Otsu threshold to segment foreground defects",
        ),
        PipelineStep(
            name="11_normalize_tensor",
            transform=_apply_normalize(),
            description="Normalize tensor for model-ready input",
        ),
    ]


def process_step(
    step: PipelineStep,
    input_obj: ImageLike,
    root_img: Image.Image,
    output_dir: Path,
    show: bool = False,
) -> Tuple[ImageLike, Dict]:
    """Run a single step, persist outputs, and return manifest record."""
    output_obj = step.transform(input_obj)

    before_pil = _to_pil(input_obj)
    after_pil = _to_pil(output_obj)

    out_img_path = output_dir / f"{step.name}.png"
    after_pil.save(out_img_path)

    hist_data = _calc_histogram(after_pil)
    strip_path = _render_strip(
        step_name=step.name,
        original_pil=root_img,
        before_pil=before_pil,
        after_pil=after_pil,
        hist_data=hist_data,
        output_dir=output_dir,
        show=show,
    )

    record = {
        "step": step.name,
        "description": step.description,
        "output_image": str(out_img_path),
        "strip_image": strip_path,
        "output_type": type(output_obj).__name__,
        "hist_channels": [c for c, _ in hist_data],
    }
    return output_obj, record


def run_histogram_pipeline(
    input_path: Union[str, Path],
    output_dir: Union[str, Path],
    steps: Optional[Sequence[PipelineStep]] = None,
    show: bool = False,
) -> Dict:
    """Execute the full pipeline and return a manifest describing outputs."""
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input image not found: {input_path}")

    options = PipelineOptions()
    pipeline = list(steps) if steps else build_default_pipeline(options)

    output_dir = _ensure_dir(output_dir)
    root_img = Image.open(input_path).convert("RGB")

    current_obj: ImageLike = root_img
    manifest_steps: List[Dict] = []

    for step in pipeline:
        current_obj, record = process_step(
            step=step,
            input_obj=current_obj,
            root_img=root_img,
            output_dir=output_dir,
            show=show,
        )
        manifest_steps.append(record)

    manifest = {
        "input_image": str(input_path),
        "output_dir": str(output_dir),
        "steps": manifest_steps,
    }

    manifest_path = output_dir / "histogram_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply IC surface defect filters and export histogram strips."
    )
    parser.add_argument("input_image", help="Path to input IC image")
    parser.add_argument(
        "--output-dir",
        default="histogram_tool_outputs",
        help="Directory to store processed images and strips",
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="Display plots while running (off by default; still saved to disk)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    manifest = run_histogram_pipeline(
        input_path=args.input_image, output_dir=args.output_dir, show=args.show
    )
    print(json.dumps(manifest, indent=2))
    print(f"\nSaved outputs to: {manifest['output_dir']}")


if __name__ == "__main__":
    main()

