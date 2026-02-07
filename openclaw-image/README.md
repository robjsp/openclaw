# OpenClaw Docker Image

This directory contains the Dockerfile and scripts for building a containerized OpenClaw gateway image.

## Contents

- `Dockerfile` - Clones the OpenClaw repo, builds it with the Firebase plugin
- `start-gateway.sh` - Entrypoint script that generates config from environment variables and starts the gateway

## Building

```bash
cd openclaw-image
docker build -t openclaw-gateway:latest .
```

## How It Works

1. **Dockerfile** clones OpenClaw from GitHub, installs dependencies, and builds from source
2. **start-gateway.sh** is copied from the cloned repo and used as the entrypoint
3. When the container starts, the script generates `/root/.openclaw/openclaw.json` from environment variables
4. Gateway starts automatically: `node dist/index.js gateway run`

## Environment Variables Needed

- `VM_INTERNAL_SECRET` - Gateway authentication token
- `LLM_PROXY_URL` - LLM proxy endpoint
- `LLM_PROXY_API_KEY` - Per-user proxy token
- `APP_SERVER_URL` - Callback URL for responses
- `OPENCLAW_STATE_DIR` - State directory path

## Running

```bash
docker run -p 3000:3000 \
  -e VM_INTERNAL_SECRET=your-secret \
  -e LLM_PROXY_API_KEY=your-api-key \
  -e APP_SERVER_URL=https://your-server.com \
  -e OPENCLAW_STATE_DIR=/data/state \
  openclaw-gateway:latest
```

## Image Details

- Base: Debian Bookworm Slim
- Node.js: v22
- Size: ~5GB (includes Node.js, OpenClaw, and all dependencies)
