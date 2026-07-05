#!/usr/bin/env python3
"""Rebuild the pgvector index from the file-based history.

Run after rsyncing data/ to a new host (e.g. the laptop) or after changing
the embedding backend. Iterates every session in data/api_results/history/
and stores it in Postgres via vector_db.store_analysis (idempotent upsert).

Usage: python scripts/reindex_vector_db.py
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import server  # noqa: F401,E402  (bootstraps backend sys.path + .env)
from server import config  # noqa: E402
from utils.history_manager import HistoryManager  # noqa: E402
from utils.vector_db import get_vector_db  # noqa: E402


def main():
    vector_db = get_vector_db()
    if not vector_db:
        sys.exit("Vector DB unavailable — check Postgres/pgvector and DB_* env vars.")

    history_manager = HistoryManager(base_dir=config.HISTORY_BASE_DIR)
    items = history_manager.load_history_list()
    print(f"Reindexing {len(items)} sessions...")

    ok = failed = 0
    for item in items:
        session_id = item.get("session_id")
        try:
            detail = history_manager.load_history_detail(session_id)
            if not detail:
                raise RuntimeError("could not load detail")
            vector_db.store_analysis(
                session_id=session_id,
                metadata=detail.get("metadata", {}),
                analysis_data=detail.get("analysis", {}),
                tool_outputs=detail.get("analysis", {}).get("tool_outputs", {}),
            )
            ok += 1
            print(f"  ✓ {session_id}")
        except Exception as e:
            failed += 1
            print(f"  ✗ {session_id}: {e}")

    print(f"Done: {ok} indexed, {failed} failed.")


if __name__ == "__main__":
    main()
