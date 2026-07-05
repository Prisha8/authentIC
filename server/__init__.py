"""authentIC web server package.

Importing this package makes the existing `backend/` modules importable
(agents.*, tools.*, utils.*) and loads the project-root .env so API keys are
available, mirroring how backend/api_server.py bootstraps itself.
"""

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

try:
    from utils import load_env
    load_env()
except Exception as _e:  # missing .env is fine until live stages are used
    print(f"[server] Warning: could not load .env: {_e}")
