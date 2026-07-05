"""Upload validation and safe artifact serving for the public site."""

import io
from pathlib import Path
from typing import Optional, Tuple

from PIL import Image

from server import config

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def validate_and_reencode_image(filename: str, data: bytes) -> Tuple[Optional[bytes], Optional[str]]:
    """Validate an uploaded image and re-encode it to a clean PNG.

    Returns (png_bytes, None) on success or (None, error_message) on failure.
    Re-encoding strips metadata/polyglot payloads and bounds dimensions.
    """
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return None, f"Unsupported file type '{ext or 'unknown'}'. Use PNG or JPG."
    if len(data) > config.MAX_IMAGE_BYTES:
        return None, f"Image too large (max {config.MAX_IMAGE_BYTES // (1024*1024)} MB)."
    if len(data) < 100:
        return None, "File is empty or truncated."

    try:
        Image.open(io.BytesIO(data)).verify()
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGB")
    except Exception:
        return None, "File is not a valid image."

    max_dim = config.MAX_IMAGE_DIMENSION
    if img.width > max_dim or img.height > max_dim:
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    if img.width < 32 or img.height < 32:
        return None, "Image is too small to analyze."

    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue(), None


def resolve_artifact(rel_path: str) -> Optional[Path]:
    """Resolve a client-supplied relative path against allowed bases.

    Rejects absolute paths and anything that escapes the base directory.
    Allowed bases: the public results dir and the demo cache.
    """
    if not rel_path:
        return None
    candidate = Path(rel_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        return None
    for base in (config.DATA_DIR, config.DEMO_CACHE_DIR):
        try:
            resolved = (base / candidate).resolve()
            if resolved.is_relative_to(base.resolve()) and resolved.is_file():
                return resolved
        except (OSError, ValueError):
            continue
    return None


def mimetype_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in (".png", ".jpg", ".jpeg", ".webp"):
        return f"image/{'jpeg' if suffix in ('.jpg', '.jpeg') else suffix[1:]}"
    if suffix == ".json":
        return "application/json"
    return "application/octet-stream"
