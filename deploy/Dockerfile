# authentIC web server — torch-free laptop image (GPU work runs on Modal).
# Build from the repo root:  docker build -f deploy/Dockerfile -t authentic-web .

FROM python:3.12-slim

# opencv-headless still needs these shared libs
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY server/requirements.txt server/requirements.txt
RUN uv pip install --system --no-cache -r server/requirements.txt

# Application code (weights/dataset are NOT copied — GPU work happens on Modal)
COPY server/ server/
COPY backend/agents/ backend/agents/
COPY backend/tools/ backend/tools/
COPY backend/utils/ backend/utils/
COPY web/ web/
COPY scripts/ scripts/

# Runtime state lives on mounted volumes: /app/data and /app/demo_cache
ENV GPU_BACKEND=modal \
    EMBEDDING_BACKEND=fastembed \
    MPLBACKEND=Agg \
    PYTHONUNBUFFERED=1

EXPOSE 8090

# Single worker is required (in-process session/progress state); threads serve
# the polling endpoints. 900s timeout covers a full live detection.
CMD ["gunicorn", "-w", "1", "--threads", "8", "--timeout", "900", \
     "-b", "0.0.0.0:8090", "server.app:app"]
