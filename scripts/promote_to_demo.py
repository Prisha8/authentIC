#!/usr/bin/env python3
"""Promote a completed detection session to a demo IC on the landing page.

The session stays where it is (data/api_results/history/<sid>/ — it doubles as
pre-populated history); this just registers it in demo_cache/manifest.json so
the site lists it as a clickable demo and replays its recorded progress.

Usage:
    python scripts/promote_to_demo.py <session_id> <demo_id> \
        --title "Authentic 8-pin DIP" \
        --description "Genuine TI opamp, front view" \
        [--expected-verdict AUTHENTIC]

Run after a live detection completed through server/app.py (which records
progress_events.json + results.json).
"""

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from server import config  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session_id")
    parser.add_argument("demo_id", help="URL-friendly id, e.g. genuine-dip8")
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--expected-verdict", default=None,
                        help="Override; defaults to the session's actual verdict")
    args = parser.parse_args()

    session_dir = config.DATA_DIR / "history" / args.session_id
    if not session_dir.exists():
        sys.exit(f"Session dir not found: {session_dir}")
    for required in ("progress_events.json", "results.json", "metadata.json"):
        if not (session_dir / required).exists():
            sys.exit(f"Missing {required} in {session_dir} — was this run through server/app.py?")

    metadata = json.loads((session_dir / "metadata.json").read_text())
    results = json.loads((session_dir / "results.json").read_text())
    ic_info = metadata.get("ic_info", {})
    verdict = args.expected_verdict or metadata.get("verdict") \
        or (results[0].get("verdict") if results else "UNKNOWN")

    thumbnail = metadata.get("file_paths", {}).get("thumbnail")
    if thumbnail and not thumbnail.startswith("history/"):
        thumbnail = f"history/{args.session_id}/{thumbnail}" \
            if not (config.DATA_DIR / thumbnail).exists() else thumbnail

    entry = {
        "demo_id": args.demo_id,
        "session_id": args.session_id,
        "title": args.title,
        "description": args.description,
        "expected_verdict": verdict,
        "part_number": ic_info.get("part_number"),
        "package_type": ic_info.get("package_type"),
        "thumbnail": thumbnail,
    }

    manifest_path = config.DEMO_CACHE_DIR / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"demos": []}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    manifest["demos"] = [d for d in manifest.get("demos", [])
                         if d.get("demo_id") != args.demo_id]
    manifest["demos"].append(entry)
    manifest_path.write_text(json.dumps(manifest, indent=2))

    print(f"Registered demo '{args.demo_id}' -> session {args.session_id}")
    print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    main()
