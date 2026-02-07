# OpenClaw Docker Image

This directory contains the Dockerfile for building a containerized OpenClaw gateway image containing the firebase plugin, with all dependencies and extensions included.

## Contents

- `Dockerfile` - Builds OpenClaw with Firebase plugin
- `start-gateway.sh` - Entrypoint script that generates config and starts gateway

## Building

```bash
# From the openclaw repository root
docker build -f openclaw-image/Dockerfile -t openclaw-gateway:latest .
```

## How It Works

1. **Dockerfile** installs Node.js, dependencies, and builds OpenClaw from source
2. **start-gateway.sh** is used as the entrypoint
3. When the container starts, the script generates `/root/.openclaw/openclaw.json` from environment variables
4. Gateway starts automatically: `node dist/index.js gateway run`

## Environment Variables

The entrypoint script reads configuration from environment variables:

- `VM_INTERNAL_SECRET` - Gateway authentication token
- `LLM_PROXY_URL` - LLM proxy endpoint (defaults to `https://grio-proxy.fly.dev`)
- `LLM_PROXY_API_KEY` - API key for LLM proxy
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
- Includes: ripgrep, git, python3, and other utilities
