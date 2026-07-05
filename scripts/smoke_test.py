#!/usr/bin/env python3
"""End-to-end smoke test against a running authentIC web server.

Usage:
    python scripts/smoke_test.py [--base http://localhost:8090] [--live path/to/ic.png]

Without --live it only exercises free endpoints (health, demos, quota, static
frontend, artifact security). With --live it uploads an image and runs a real
detection (consumes rate-limit quota and Modal/Gemini budget).
"""

import argparse
import sys
import time

import requests


def check(name, ok, extra=""):
    print(f"  {'✓' if ok else '✗'} {name} {extra}")
    return ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:8090")
    parser.add_argument("--live", default=None, help="Image path for a live detection")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    failures = 0

    print(f"Smoke testing {base}")

    r = requests.get(f"{base}/api/health", timeout=10)
    failures += not check("/api/health", r.ok and r.json().get("status") == "healthy",
                          f"(gpu_backend={r.json().get('gpu_backend')})" if r.ok else "")

    r = requests.get(f"{base}/", timeout=10)
    failures += not check("landing page", r.ok and "authentIC" in r.text)

    r = requests.get(f"{base}/dashboard.html", timeout=10)
    failures += not check("dashboard page", r.ok)

    r = requests.get(f"{base}/api/quota", timeout=10)
    failures += not check("/api/quota", r.ok and "live_detections_remaining" in r.json())

    r = requests.get(f"{base}/api/demos", timeout=10)
    demos = r.json().get("demos", []) if r.ok else []
    failures += not check("/api/demos", r.ok, f"({len(demos)} demos)")

    # Security: traversal + absolute path must fail
    r = requests.get(f"{base}/api/download", params={"file": "../../etc/passwd"}, timeout=10)
    failures += not check("traversal blocked", r.status_code in (400, 404))
    r = requests.get(f"{base}/api/download", params={"file": "/etc/passwd"}, timeout=10)
    failures += not check("absolute path blocked", r.status_code in (400, 404))

    r = requests.get(f"{base}/api/history", timeout=30)
    hist = r.json().get("history", []) if r.ok else []
    failures += not check("/api/history", r.ok, f"({len(hist)} sessions)")

    # Demo replay end-to-end
    if demos:
        demo_id = demos[0]["demo_id"]
        r = requests.post(f"{base}/api/detect", data={"demo_id": demo_id}, timeout=10)
        ok = r.ok and r.json().get("session_id")
        failures += not check(f"demo replay start ({demo_id})", ok)
        if ok:
            sid = r.json()["session_id"]
            failures += not check("demo replay completes", _wait_complete(base, sid, 180))
            r = requests.get(f"{base}/api/report/{sid}", timeout=30)
            failures += not check("demo report PDF", r.ok and r.content[:4] == b"%PDF")

    if args.live:
        with open(args.live, "rb") as f:
            r = requests.post(f"{base}/api/detect", files={"image": f}, timeout=60)
        ok = r.ok and r.json().get("session_id")
        failures += not check("live detection start", ok,
                              "" if ok else r.text[:200])
        if ok:
            sid = r.json()["session_id"]
            failures += not check("live detection completes", _wait_complete(base, sid, 900))
            r = requests.get(f"{base}/api/report/{sid}", timeout=60)
            failures += not check("live report PDF", r.ok and r.content[:4] == b"%PDF")

    print(("\nFAILED" if failures else "\nALL PASSED") + f" ({failures} failures)")
    sys.exit(1 if failures else 0)


def _wait_complete(base, sid, timeout_s):
    deadline = time.time() + timeout_s
    last_step = ""
    while time.time() < deadline:
        r = requests.get(f"{base}/api/progress/{sid}", timeout=30)
        if r.ok:
            session = r.json().get("session") or {}
            step = session.get("current_step", "")
            if step != last_step:
                print(f"      … {step}")
                last_step = step
            if session.get("status") == "completed":
                return True
            if session.get("status") == "failed":
                print(f"      failed: {session.get('error')}")
                return False
        time.sleep(3)
    print("      timeout")
    return False


if __name__ == "__main__":
    main()
