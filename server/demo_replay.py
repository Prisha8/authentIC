"""Demo IC replays.

A "demo" is a real pipeline run that was executed once through the production
code path and kept in data/api_results/history/<session_id>/ (it also shows up
in the pre-populated history). The runner journals its progress events to
progress_events.json and the final chat results to results.json.

Replaying = creating a fresh runtime session whose progress feed re-emits the
recorded events with realistic (clamped) delays. Nothing is recomputed and no
external API is touched, so replays are free and bypass rate limits — but the
content shown is the genuine pipeline output.

demo_cache/manifest.json format:
{
  "demos": [
    {
      "demo_id": "genuine-dip8",
      "session_id": "<uuid of the recorded run>",
      "title": "Authentic 8-pin DIP",
      "description": "…",
      "expected_verdict": "AUTHENTIC",
      "part_number": "…", "package_type": "08DIP",
      "thumbnail": "history/<sid>/images/thumbnail.png"   # relative to DATA_DIR
    }
  ]
}
"""

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from server import config

MIN_STEP_DELAY = 1.2   # seconds between replayed events
MAX_STEP_DELAY = 8.0

_manifest_cache = None
_manifest_mtime = None


def _manifest_path() -> Path:
    return config.DEMO_CACHE_DIR / "manifest.json"


def load_manifest() -> Dict:
    """Load (and mildly cache) the demo manifest."""
    global _manifest_cache, _manifest_mtime
    path = _manifest_path()
    if not path.exists():
        return {"demos": []}
    mtime = path.stat().st_mtime
    if _manifest_cache is None or mtime != _manifest_mtime:
        _manifest_cache = json.loads(path.read_text())
        _manifest_mtime = mtime
    return _manifest_cache


def list_demos() -> List[Dict]:
    from urllib.parse import quote
    demos = []
    for d in load_manifest().get("demos", []):
        thumb = d.get("thumbnail")
        demos.append({
            "demo_id": d.get("demo_id"),
            "title": d.get("title"),
            "description": d.get("description"),
            "expected_verdict": d.get("expected_verdict"),
            "part_number": d.get("part_number"),
            "package_type": d.get("package_type"),
            "thumbnail_url": f"/api/download?file={quote(thumb, safe='')}" if thumb else None,
        })
    return demos


def get_demo(demo_id: str) -> Optional[Dict]:
    for d in load_manifest().get("demos", []):
        if d.get("demo_id") == demo_id:
            return d
    return None


def _session_dir(source_session_id: str) -> Path:
    return config.DATA_DIR / "history" / source_session_id


def start_replay(demo: Dict, new_session_id: str, sessions: Dict, progress_queue) -> None:
    """Spawn the background thread that drip-feeds recorded events."""
    source_sid = demo["session_id"]
    session_dir = _session_dir(source_sid)
    events_path = session_dir / "progress_events.json"
    results_path = session_dir / "results.json"

    recorded = json.loads(events_path.read_text())
    results_list = json.loads(results_path.read_text()) if results_path.exists() else []

    def run():
        prev_offset = 0.0
        for item in recorded:
            event = dict(item.get("event", {}))
            offset = float(item.get("t_offset", prev_offset))
            delay = max(MIN_STEP_DELAY, min(MAX_STEP_DELAY, offset - prev_offset))
            prev_offset = offset
            time.sleep(delay)

            # Rewrite the recorded session id to the live replay session
            if event.get("session_id"):
                event["session_id"] = new_session_id
            progress_queue.put(event)

            if event.get("type") == "error":
                sessions[new_session_id].update({
                    "status": "failed",
                    "error": event.get("message", "replay error"),
                    "failed_at": datetime.now().isoformat(),
                })
                return

        sessions[new_session_id].update({
            "status": "completed",
            "results": results_list,
            "completed_at": datetime.now().isoformat(),
            "current_step": "Complete",
            "demo_id": demo.get("demo_id"),
            "source_session_id": source_sid,
        })
        # Runner-recorded events already include the final 'complete' event; if
        # the recording predates that convention, emit one for safety.
        if not any(i.get("event", {}).get("type") == "complete" for i in recorded):
            progress_queue.put({"type": "complete", "session_id": new_session_id})

    threading.Thread(target=run, daemon=True).start()


def replay_available(demo: Dict) -> Optional[str]:
    """Return an error string if this demo can't be replayed, else None."""
    session_dir = _session_dir(demo["session_id"])
    if not (session_dir / "progress_events.json").exists():
        return f"Recorded progress events missing for demo '{demo.get('demo_id')}'"
    return None
