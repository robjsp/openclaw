#!/bin/bash
set -e

echo "Starting OpenClaw Gateway..."

# ---------------------------------------------------------------------------
# Static configuration for sidecar-based deployment.
#
# All external communication goes through the sidecar proxy on localhost:4000.
# The sidecar reads real per-clone values from MMDS after snapshot restore.
# OpenClaw never needs to know about MMDS or per-clone credentials.
# ---------------------------------------------------------------------------

FIXED_INTERNAL_SECRET="grio-internal-fixed-token"

echo "Generating configuration..."

cat > /root/.openclaw/openclaw.json << CONFIGEOF
{
  "gateway": {
    "mode": "local",
    "port": 3000,
    "bind": "lan",
    "auth": {
      "token": "${FIXED_INTERNAL_SECRET}"
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
        "baseUrl": "http://localhost:4000",
        "apiKey": "sidecar-will-replace",
        "api": "anthropic-messages",
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

# Export fixed env vars for the Firebase plugin.
# These are static — the sidecar handles swapping to real values on outbound.
export VM_INTERNAL_SECRET="${FIXED_INTERNAL_SECRET}"
export APP_SERVER_URL="http://localhost:4000"
export LLM_PROXY_URL="http://localhost:4000"
export LLM_PROXY_API_KEY="sidecar-will-replace"

echo "  LLM_PROXY_URL: $LLM_PROXY_URL (via sidecar)"
echo "  APP_SERVER_URL: $APP_SERVER_URL (via sidecar)"
echo "  VM_INTERNAL_SECRET: [fixed]"
echo "Starting gateway process..."

# Start gateway
cd /workspace/openclaw
exec node dist/index.js gateway run
