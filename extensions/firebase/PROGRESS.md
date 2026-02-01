# Firebase Plugin Progress Report

**Date:** 2026-02-01
**Status:** ✅ Implementation Complete

---

## Summary

The OpenClaw Firebase channel plugin for the Grio platform has been fully implemented. This plugin enables OpenClaw to receive messages from the Grio App Server, process them via the LLM Proxy, and send responses back—all through HTTP APIs with no direct Firebase/Firestore access.

---

## Completed Tasks

### 1. Plugin Structure ✅
```
openclaw/extensions/firebase/
├── src/
│   ├── types.ts         # Shared type definitions
│   ├── runtime.ts       # Plugin runtime management
│   ├── respond.ts       # HTTP client for App Server
│   ├── llm-client.ts    # LLM Proxy streaming client
│   ├── monitor.ts       # HTTP webhook handler
│   └── channel.ts       # ChannelPlugin implementation
├── test/
│   ├── mock-services.ts      # Mock servers for development
│   ├── run-tests.mjs         # Main test suite
│   ├── test-billing-error.mjs # Billing error test
│   └── integration.test.ts   # Bun test suite
├── index.ts             # Plugin entry point
├── standalone.ts        # Standalone development server
├── openclaw.plugin.json # Plugin manifest
├── package.json         # Package configuration
└── tsconfig.json        # TypeScript configuration
```

### 2. Core Components ✅

| Component | File | Description |
|-----------|------|-------------|
| Types | `src/types.ts` | `VmTriggerRequest`, `VmResponseRequest`, `FirebaseResolvedAccount` |
| HTTP Trigger | `src/monitor.ts` | Receives `POST /api/message` from App Server |
| LLM Client | `src/llm-client.ts` | Streaming SSE client for LLM Proxy |
| Response Client | `src/respond.ts` | Sends responses to App Server |
| Channel Plugin | `src/channel.ts` | OpenClaw `ChannelPlugin` implementation |
| Entry Point | `index.ts` | Plugin registration with OpenClaw |

### 3. Features Implemented ✅

- [x] HTTP trigger endpoint with secret validation
- [x] Asynchronous message processing
- [x] LLM Proxy streaming with SSE parsing
- [x] Support for both Anthropic and OpenAI response formats
- [x] Response delivery to App Server
- [x] Billing error detection (HTTP 402)
- [x] Billing error response with `purchase_credits` action
- [x] Generic error handling with user-friendly messages
- [x] Health check endpoint
- [x] OpenClaw channel plugin integration
- [x] Gateway lifecycle management

---

## Test Results

### Main Test Suite (8/8 passed)
```
✓ should reject requests without authorization
✓ should reject requests with wrong authorization
✓ should accept valid requests and return processing status
✓ should send response to App Server after processing
✓ should reject requests with missing messageId
✓ should reject requests with missing text
✓ should respond to health check
✓ should return 404 for unknown endpoints
```

### Billing Error Test (passed)
```
✓ Billing error handled correctly!
  - errorType: billing
  - action: purchase_credits
  - content: "You've run out of credits! Tap below to purchase more."
```

---

## API Specification

### Inbound (App Server → VM)

```
POST /api/message
Headers:
  Authorization: Bearer <VM_INTERNAL_SECRET>
  Content-Type: application/json
Body:
  {
    "messageId": "string",
    "text": "string",
    "conversationHistory": [{ "role": "user"|"assistant", "content": "string" }]
  }
Response:
  200 { "status": "processing" }
  400 { "error": "Missing or invalid messageId|text" }
  401 { "error": "Unauthorized" }
```

### Outbound (VM → App Server)

```
POST /api/response
Headers:
  Authorization: Bearer <VM_INTERNAL_SECRET>
  Content-Type: application/json
Body:
  {
    "messageId": "string",
    "content": "string",
    "metadata": {
      "errorType": "billing"|"error",
      "action": "purchase_credits",
      "model": "string",
      "tokens": number
    }
  }
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VM_INTERNAL_SECRET` | Yes | Secret for authenticating with App Server |
| `LLM_PROXY_API_KEY` | Yes | API key for LLM Proxy |
| `LLM_PROXY_URL` | No | LLM Proxy URL (default: `http://localhost:3001`) |
| `APP_SERVER_URL` | No | App Server URL (default: `http://localhost:3000`) |
| `PORT` | No | Standalone server port (default: `8080`) |

---

## Running the Plugin

### Development (Standalone Mode)

```bash
# Terminal 1: Start mock services
cd openclaw/extensions/firebase
npx tsx test/mock-services.ts

# Terminal 2: Start plugin
VM_INTERNAL_SECRET=sec_test \
LLM_PROXY_URL=http://localhost:3001 \
LLM_PROXY_API_KEY=pxy_test \
APP_SERVER_URL=http://localhost:3000 \
npx tsx standalone.ts

# Terminal 3: Test
curl -X POST http://localhost:8080/api/message \
  -H "Authorization: Bearer sec_test" \
  -H "Content-Type: application/json" \
  -d '{"messageId": "test123", "text": "Hello AI"}'
```

### Running Tests

```bash
cd openclaw/extensions/firebase
npx tsx test/run-tests.mjs
npx tsx test/test-billing-error.mjs
```

---

## Integration Points

### With App Server (Stream B)

The App Server triggers this plugin when a user sends a message:
1. App Server receives message from client
2. App Server writes to Firestore
3. App Server calls `POST /api/message` on VM with message content
4. VM processes and calls `POST /api/response` on App Server
5. App Server writes assistant response to Firestore
6. Client receives response via Firestore onSnapshot

### With LLM Proxy (Stream A)

The plugin calls the LLM Proxy for AI responses:
1. Plugin builds messages array with conversation history
2. Plugin calls `POST /v1/responses` with streaming enabled
3. Plugin parses SSE stream and accumulates content
4. Plugin extracts usage metrics from final events

---

## Architecture Diagram

```
┌─────────────┐     POST /api/message      ┌──────────────────┐
│             │ ──────────────────────────▶│                  │
│ App Server  │                            │  Firebase Plugin │
│ (Stream B)  │ ◀────────────────────────── │  (This Plugin)   │
│             │     POST /api/response     │                  │
└─────────────┘                            └────────┬─────────┘
                                                    │
                                                    │ POST /v1/responses
                                                    │ (streaming)
                                                    ▼
                                           ┌──────────────────┐
                                           │                  │
                                           │   LLM Proxy      │
                                           │   (Stream A)     │
                                           │                  │
                                           └──────────────────┘
```

---

## Security Notes

- **No Firebase credentials**: This plugin runs on untrusted VMs and has no direct database access
- **Secret validation**: All requests must include valid `VM_INTERNAL_SECRET`
- **HTTP-only communication**: All data flows through authenticated HTTP APIs

---

## Next Steps

1. **Integration Testing**: Test with real App Server and LLM Proxy
2. **Deployment**: Deploy to Fly.io VM with proper secrets
3. **Monitoring**: Add logging and metrics collection
4. **Error Recovery**: Implement retry logic for transient failures

---

## Files Modified

| File | Action |
|------|--------|
| `PLAN.md` | Updated checkboxes to mark completion |
| All source files | Created from scratch |

---

## Verification Checklist

- [x] Plugin builds without errors
- [x] HTTP trigger validates secret correctly
- [x] Plugin calls LLM Proxy with streaming
- [x] Plugin parses SSE stream correctly (Anthropic + OpenAI formats)
- [x] Plugin sends response back to App Server
- [x] Billing errors are handled (402 → purchase_credits action)
- [x] General errors return friendly message
- [x] All tests pass
