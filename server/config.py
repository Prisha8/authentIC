"""Central configuration for the authentIC web server (laptop host).

Everything is env-overridable; defaults suit local development at the repo
root. Secrets (GEMINI_API_KEY, TAVILY_API_KEY, MODAL_TOKEN_*) come from the
project-root .env, loaded via backend/utils.load_env().
"""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
WEB_DIR = PROJECT_ROOT / "web"
DEMO_CACHE_DIR = Path(os.getenv("DEMO_CACHE_DIR", PROJECT_ROOT / "demo_cache"))

# Single public storage space (the old app's "business" flow)
DATA_DIR = Path(os.getenv("DATA_DIR", PROJECT_ROOT / "data" / "api_results"))
HISTORY_BASE_DIR = "data/api_results"  # HistoryManager resolves this from project root

# GPU backend: "modal" (production) or "local" (dev box with a GPU)
GPU_BACKEND = os.getenv("GPU_BACKEND", "modal").strip().lower()
MODAL_APP_NAME = os.getenv("MODAL_APP_NAME", "authentic-gpu")

PIN_COUNTER_WEIGHTS_PATH = os.getenv("PIN_COUNTER_WEIGHTS_PATH") or str(
    BACKEND_DIR / "weights" / "pin_counter.pt"
)

# Upload constraints (public site)
MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", 10 * 1024 * 1024))  # 10 MB
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", 8 * 1024 * 1024))  # 8 MB per image
MAX_IMAGE_DIMENSION = int(os.getenv("MAX_IMAGE_DIMENSION", 4096))
MAX_IMAGES_PER_REQUEST = int(os.getenv("MAX_IMAGES_PER_REQUEST", 3))

# Rate limits (per calendar day, UTC)
LIVE_DETECTIONS_PER_IP_PER_DAY = int(os.getenv("LIVE_DETECTIONS_PER_IP_PER_DAY", 3))
LIVE_DETECTIONS_GLOBAL_PER_DAY = int(os.getenv("LIVE_DETECTIONS_GLOBAL_PER_DAY", 10))
CHAT_MESSAGES_PER_IP_PER_DAY = int(os.getenv("CHAT_MESSAGES_PER_IP_PER_DAY", 20))
RAG_SEARCHES_PER_IP_PER_DAY = int(os.getenv("RAG_SEARCHES_PER_IP_PER_DAY", 20))

# Monthly Modal budget guard: estimated $/detection * live detections this month
MODAL_BUDGET_USD = float(os.getenv("MODAL_BUDGET_USD", 25.0))
EST_COST_PER_DETECTION_USD = float(os.getenv("EST_COST_PER_DETECTION_USD", 0.12))

RATELIMIT_DB_PATH = Path(os.getenv("RATELIMIT_DB_PATH", PROJECT_ROOT / "data" / "ratelimit.db"))

# Public site is read-mostly: verdict overrides / deletes / annotation writes
# are disabled unless explicitly enabled (e.g. for your own curation sessions).
ALLOW_MUTATIONS = os.getenv("ALLOW_MUTATIONS", "false").strip().lower() in ("true", "1", "yes")

SERVER_PORT = int(os.getenv("PORT", 8090))
