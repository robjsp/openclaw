#!/bin/bash
set -e

echo "Starting OpenClaw Gateway..."

# ---------------------------------------------------------------------------
# VIO runtime-aware env var helper
#
# In Firecracker mode, per-clone env vars are injected via MMDS and must be
# read from http://169.254.169.254/env/KEY_NAME.
# In Docker mode (or outside VIO), they're standard shell env vars.
#
# This helper tries MMDS first, then falls back to printenv.
# ---------------------------------------------------------------------------
vio_env() {
  curl -sf "http://169.254.169.254/env/$1" 2>/dev/null || printenv "$1" 2>/dev/null || echo ""
}

echo "Runtime: ${VIO_RUNTIME:-unknown}"
echo "Resolving environment variables..."

# Resolve all required env vars (works in both Firecracker and Docker)
RESOLVED_VM_INTERNAL_SECRET=$(vio_env VM_INTERNAL_SECRET)
RESOLVED_LLM_PROXY_URL=$(vio_env LLM_PROXY_URL)
RESOLVED_LLM_PROXY_API_KEY=$(vio_env LLM_PROXY_API_KEY)
RESOLVED_LLM_API_TYPE=$(vio_env LLM_API_TYPE)
RESOLVED_APP_SERVER_URL=$(vio_env APP_SERVER_URL)

# Apply defaults
RESOLVED_LLM_PROXY_URL="${RESOLVED_LLM_PROXY_URL:-https://grio-proxy.fly.dev}"
RESOLVED_LLM_API_TYPE="${RESOLVED_LLM_API_TYPE:-anthropic-messages}"

echo "  LLM_PROXY_URL: $RESOLVED_LLM_PROXY_URL"
echo "  LLM_API_TYPE: $RESOLVED_LLM_API_TYPE"
echo "  APP_SERVER_URL: $RESOLVED_APP_SERVER_URL"
echo "  VM_INTERNAL_SECRET: ${RESOLVED_VM_INTERNAL_SECRET:+[set]}"

# Generate openclaw.json
echo "Generating configuration..."

cat > /root/.openclaw/openclaw.json << CONFIGEOF
{
  "gateway": {
    "mode": "local",
    "port": 3000,
    "bind": "lan",
    "auth": {
      "token": "${RESOLVED_VM_INTERNAL_SECRET}"
    }
  },
  "agents": {
    "defaults": {
      "workspace": "/data/workspace",
      "model": {
        "primary": "grio-proxy/claude-haiku-4-5-20251001"
      }
    }
  },
  "models": {
    "mode": "replace",
    "providers": {
      "grio-proxy": {
        "baseUrl": "${RESOLVED_LLM_PROXY_URL}",
        "apiKey": "${RESOLVED_LLM_PROXY_API_KEY}",
        "api": "${RESOLVED_LLM_API_TYPE}",
        "models": [
          {
            "id": "claude-haiku-4-5-20251001",
            "name": "Claude Haiku 4.5",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "plugins": {
    "entries": {
      "firebase": {
        "enabled": true
      }
    },
    "load": {
      "paths": ["/workspace/openclaw/extensions/firebase"]
    }
  }
}
CONFIGEOF

echo "Configuration generated at /root/.openclaw/openclaw.json"
echo "Starting gateway process..."

# Start gateway
cd /workspace/openclaw
exec node dist/index.js gateway run
