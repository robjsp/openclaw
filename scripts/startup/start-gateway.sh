#!/bin/bash
set -e

echo "Starting OpenClaw Gateway..."
echo "Generating configuration from environment variables..."

# Generate openclaw.json from environment variables
cat > /root/.openclaw/openclaw.json << CONFIGEOF
{
  "gateway": {
    "mode": "local",
    "port": 3000,
    "bind": "lan",
    "auth": {
      "token": "${VM_INTERNAL_SECRET}"
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
        "baseUrl": "${LLM_PROXY_URL:-https://grio-proxy.fly.dev}",
        "apiKey": "${LLM_PROXY_API_KEY}",
        "api": "openai-responses",
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
