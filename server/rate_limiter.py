"""SQLite-backed rate limiting for the public site.

Tracks per-IP and global daily counters per action kind, plus a monthly
Modal budget guard for live detections. Single-process server (gunicorn -w 1),
so SQLite with a short lock is plenty.
"""

import sqlite3
import threading
from datetime import datetime, timezone

from server import config

_LOCK = threading.Lock()

KIND_DETECT = "detect"
KIND_CHAT = "chat"
KIND_RAG = "rag"


def _connect():
    config.RATELIMIT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.RATELIMIT_DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS events ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " ip TEXT NOT NULL,"
        " kind TEXT NOT NULL,"
        " day TEXT NOT NULL,"
        " month TEXT NOT NULL,"
        " ts TEXT NOT NULL)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_day ON events(kind, day, ip)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_month ON events(kind, month)")
    return conn


def _now_keys():
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d"), now.strftime("%Y-%m"), now.isoformat()


def _counts(conn, kind: str, ip: str):
    day, month, _ = _now_keys()
    ip_day = conn.execute(
        "SELECT COUNT(*) FROM events WHERE kind=? AND day=? AND ip=?",
        (kind, day, ip)).fetchone()[0]
    global_day = conn.execute(
        "SELECT COUNT(*) FROM events WHERE kind=? AND day=?",
        (kind, day)).fetchone()[0]
    global_month = conn.execute(
        "SELECT COUNT(*) FROM events WHERE kind=? AND month=?",
        (kind, month)).fetchone()[0]
    return ip_day, global_day, global_month


def check_and_record(kind: str, ip: str):
    """Atomically check quota and record the event.

    Returns (allowed: bool, info: dict). info always carries remaining counts
    so the frontend can show "X analyses left today".
    """
    limits = {
        KIND_DETECT: (config.LIVE_DETECTIONS_PER_IP_PER_DAY,
                      config.LIVE_DETECTIONS_GLOBAL_PER_DAY),
        KIND_CHAT: (config.CHAT_MESSAGES_PER_IP_PER_DAY, None),
        KIND_RAG: (config.RAG_SEARCHES_PER_IP_PER_DAY, None),
    }
    ip_limit, global_limit = limits[kind]

    with _LOCK:
        conn = _connect()
        try:
            ip_day, global_day, global_month = _counts(conn, kind, ip)

            if ip_day >= ip_limit:
                return False, {
                    "reason": "ip_daily_limit",
                    "message": "Daily limit reached for your IP. Try the demo ICs — those are free and instant!",
                    "remaining": 0,
                }
            if global_limit is not None and global_day >= global_limit:
                return False, {
                    "reason": "global_daily_limit",
                    "message": "The daily budget for live analyses is used up. Demo ICs still work — try one!",
                    "remaining": 0,
                }
            if kind == KIND_DETECT:
                projected = (global_month + 1) * config.EST_COST_PER_DETECTION_USD
                if projected > config.MODAL_BUDGET_USD:
                    return False, {
                        "reason": "monthly_budget",
                        "message": "This month's GPU budget is exhausted. Demo ICs are always available!",
                        "remaining": 0,
                    }

            day, month, ts = _now_keys()
            conn.execute(
                "INSERT INTO events (ip, kind, day, month, ts) VALUES (?,?,?,?,?)",
                (ip, kind, day, month, ts))
            conn.commit()
            return True, {"remaining": ip_limit - ip_day - 1}
        finally:
            conn.close()


def remaining(kind: str, ip: str) -> int:
    limits = {
        KIND_DETECT: config.LIVE_DETECTIONS_PER_IP_PER_DAY,
        KIND_CHAT: config.CHAT_MESSAGES_PER_IP_PER_DAY,
        KIND_RAG: config.RAG_SEARCHES_PER_IP_PER_DAY,
    }
    with _LOCK:
        conn = _connect()
        try:
            ip_day, _, _ = _counts(conn, kind, ip)
            return max(0, limits[kind] - ip_day)
        finally:
            conn.close()


def client_ip(request) -> str:
    """Real client IP behind Cloudflare Tunnel, else remote_addr."""
    return (request.headers.get("CF-Connecting-IP")
            or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.remote_addr
            or "unknown")
