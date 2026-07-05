# Deploying authentIC to the home server

Target: Dell Inspiron 15 3520 (8GB RAM) already running one dockerized project
behind a host-level Cloudflare Tunnel. This adds a second compose stack on
port **8090** and a new tunnel ingress for `authentic.<your-domain>`.

## What runs where

| Piece | Where | RAM |
|---|---|---|
| Flask web server (gunicorn, 1 worker) | `authentic-web` container | ~300–700 MB peak |
| Postgres 16 + pgvector (RAG search) | `authentic-db` container | ~250 MB |
| SAM + EasyOCR + YOLO + histogram filters | **Modal** (serverless T4) | 0 on laptop |
| Gemini / Tavily calls | app container (network only) | — |

No torch on the laptop. Estimated GPU cost ≈ $0.07–0.12 per live detection
against Modal's $30/month free credits; the app enforces 3 live runs/IP/day,
10/day global, and a monthly budget kill-switch (`MODAL_BUDGET_USD`).

## One-time setup

1. **Copy the repo + data to the laptop** (from the dev box):
   ```bash
   rsync -av --exclude .venv --exclude node_modules ~/projects/authentIC/authentIC/ laptop:~/apps/authentic/
   # data/ holds the pre-computed demo sessions + history — include it:
   rsync -av ~/projects/authentIC/authentIC/data/ laptop:~/apps/authentic/data/
   ```

2. **Create `.env` at the repo root on the laptop** (chmod 600):
   ```
   GEMINI_API_KEY=...
   TAVILY_API_KEY=tvly-...
   MODAL_TOKEN_ID=ak-...
   MODAL_TOKEN_SECRET=as-...
   DB_PASSWORD=<pick-a-password>
   ```
   Modal tokens: `cat ~/.modal.toml` on the dev box after `modal setup`.

3. **Start the stack**:
   ```bash
   cd ~/apps/authentic
   docker compose -f deploy/docker-compose.yml up -d --build
   curl -s localhost:8090/api/health
   ```

4. **Populate the RAG index** (once, after data/ is in place):
   ```bash
   docker exec authentic-web python scripts/reindex_vector_db.py
   ```

5. **Cloudflare Tunnel ingress** — edit the existing `/etc/cloudflared/config.yml`,
   add ABOVE the catch-all rule:
   ```yaml
   - hostname: authentic.<your-domain>
     service: http://localhost:8090
   ```
   Then:
   ```bash
   cloudflared tunnel route dns <tunnel-name-or-id> authentic.<your-domain>
   sudo systemctl restart cloudflared
   ```

6. **Smoke test** (from anywhere):
   ```bash
   python scripts/smoke_test.py --base https://authentic.<your-domain>
   ```

## Updating

```bash
cd ~/apps/authentic
git pull            # or rsync from the dev box
docker compose -f deploy/docker-compose.yml up -d --build
```

## Notes / gotchas

- **Single gunicorn worker is mandatory** — sessions and progress queues are
  in-process. Threads (8) handle the polling traffic fine.
- `data/` and `demo_cache/` are bind mounts; deleting the containers never
  deletes results.
- The Modal app must be deployed separately (from any machine with the repo +
  Modal auth): `modal deploy modal_gpu/app.py`. The laptop only *calls* it.
- Rate limits / budget knobs are env vars — see `server/config.py`
  (`LIVE_DETECTIONS_PER_IP_PER_DAY`, `LIVE_DETECTIONS_GLOBAL_PER_DAY`,
  `MODAL_BUDGET_USD`, `ALLOW_MUTATIONS`, …).
- To curate new demos: run a detection on the site (or locally), then
  `docker exec authentic-web python scripts/promote_to_demo.py <session_id> <demo-id> --title "..."`.
