# Stream C: OpenClaw Firebase Plugin - Implementation Plan

## Goal
Create a custom OpenClaw channel plugin that integrates with the Grio platform via HTTP (no direct Firestore access).

## Scope Boundaries

**YOU ARE WORKING ON:**
- `openclaw/extensions/firebase/` only
- HTTP trigger endpoint (receives messages from App Server)
- HTTP response client (sends responses to App Server)
- LLM Proxy client (streaming SSE)
- SSE parsing and content extraction
- Billing error handling

**DO NOT TOUCH:**
- `server/proxy/` (LLM Proxy - Stream A)
- `server/app/` (App Server - Stream B)
- `client/` (React Native - Stream D)
- Firestore directly (this plugin has NO database access)
- Firebase Auth (not used by this plugin)

**EXTERNAL DEPENDENCIES (use mocks):**
- App Server `/api/response` → Use mock server (included in plan)
- LLM Proxy `/v1/responses` → Use mock server (included in plan)
- Real App Server/Proxy → NOT needed for this stream

**KEY CONSTRAINT:**
This plugin runs on untrusted VMs. It must NOT have any Firebase credentials or direct database access. All data flows through HTTP APIs.

## Current State
- [x] Plugin structure created
- [x] HTTP trigger endpoint (receives from App Server)
- [x] HTTP response client (sends to App Server)
- [x] LLM Proxy client (streaming)
- [x] Billing error handling
- [x] Integration with OpenClaw

## Prerequisites
- Understanding of OpenClaw channel plugin architecture
- Mock App Server running (provided in this plan)
- Mock LLM Proxy running (provided in this plan)

## Research First

Before implementing, study these existing plugins:

```bash
# Look at existing channel implementations
ls -la openclaw/extensions/
cat openclaw/extensions/telegram/openclaw.plugin.json
cat openclaw/extensions/telegram/src/channel.ts
```

Key files to understand:
- `openclaw/src/channels/plugins/types.plugin.ts` - Plugin interface
- `openclaw/src/channels/registry.ts` - How channels are registered
- `openclaw/extensions/telegram/` - Reference implementation

---

## Tasks

### 1. Create Plugin Structure

```
openclaw/extensions/firebase/
├── src/
│   ├── channel.ts      # Channel plugin implementation
│   ├── trigger.ts      # HTTP endpoint handler
│   └── respond.ts      # HTTP client to App Server
├── index.ts            # Entry point
├── openclaw.plugin.json
├── package.json
└── tsconfig.json
```

---

### 2. Create Plugin Manifest
**File:** `openclaw.plugin.json`

```json
{
  "name": "firebase",
  "version": "0.0.1",
  "description": "Firebase channel plugin for Grio platform",
  "main": "dist/index.js",
  "channel": {
    "id": "firebase",
    "name": "Firebase",
    "description": "Grio Firebase messaging channel"
  }
}
```

---

### 3. Create Package.json
**File:** `package.json`

```json
{
  "name": "@openclaw/channel-firebase",
  "version": "0.0.1",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@grio/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.11.0"
  }
}
```

---

### 4. Implement HTTP Trigger Handler
**File:** `src/trigger.ts`

This receives messages from App Server:

```typescript
import type { VmTriggerRequest, VmTriggerResponse } from '@grio/shared';

const VM_INTERNAL_SECRET = process.env.VM_INTERNAL_SECRET;

export interface TriggerHandler {
  onMessage(messageId: string, text: string, history?: Array<{role: string, content: string}>): Promise<void>;
}

export function createTriggerEndpoint(handler: TriggerHandler) {
  return async (req: Request): Promise<Response> => {
    // Validate secret
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${VM_INTERNAL_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body: VmTriggerRequest = await req.json();
    
    // Process asynchronously
    handler.onMessage(body.messageId, body.text, body.conversationHistory)
      .catch(err => console.error('Message processing failed:', err));

    const response: VmTriggerResponse = { status: 'processing' };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
```

---

### 5. Implement Response Client
**File:** `src/respond.ts`

This sends responses back to App Server:

```typescript
import type { VmResponseRequest } from '@grio/shared';

const APP_SERVER_URL = process.env.APP_SERVER_URL || 'http://localhost:3000';
const VM_INTERNAL_SECRET = process.env.VM_INTERNAL_SECRET;

export async function sendResponse(
  messageId: string,
  content: string,
  metadata?: { errorType?: string; action?: string }
): Promise<void> {
  const body: VmResponseRequest = {
    messageId,
    content,
    metadata,
  };

  const response = await fetch(`${APP_SERVER_URL}/api/response`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VM_INTERNAL_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to send response: ${response.status}`);
  }
}

export function isBillingError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes('402') ||
    lower.includes('insufficient credits') ||
    lower.includes('billing')
  );
}
```

---

### 6. Implement Channel Plugin
**File:** `src/channel.ts`

```typescript
import { sendResponse, isBillingError } from './respond.js';

const LLM_PROXY_URL = process.env.LLM_PROXY_URL || 'http://localhost:3001';
const LLM_PROXY_API_KEY = process.env.LLM_PROXY_API_KEY;

export class FirebaseChannel {
  async processMessage(
    messageId: string,
    text: string,
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<void> {
    try {
      // Build messages array
      const messages = [
        ...(conversationHistory || []),
        { role: 'user', content: text },
      ];

      // Call LLM Proxy
      const response = await fetch(`${LLM_PROXY_URL}/v1/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LLM_PROXY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        
        // Check for billing error
        if (response.status === 402 || isBillingError(error.error?.message)) {
          await sendResponse(messageId, 
            "You've run out of credits! Tap below to purchase more.",
            { errorType: 'billing', action: 'purchase_credits' }
          );
          return;
        }

        throw new Error(`LLM request failed: ${response.status}`);
      }

      // Parse streaming response
      const content = await this.parseSSEStream(response);
      
      // Send response back to App Server
      await sendResponse(messageId, content);
      
    } catch (error) {
      console.error('Failed to process message:', error);
      await sendResponse(messageId, 
        'Sorry, something went wrong. Please try again.',
        { errorType: 'error' }
      );
    }
  }

  private async parseSSEStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            // Anthropic format
            if (data.delta?.text) {
              content += data.delta.text;
            }
            // OpenAI format
            if (data.choices?.[0]?.delta?.content) {
              content += data.choices[0].delta.content;
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
    }

    return content;
  }
}
```

---

### 7. Create Entry Point
**File:** `index.ts`

```typescript
import { FirebaseChannel } from './src/channel.js';
import { createTriggerEndpoint } from './src/trigger.js';

export const channel = new FirebaseChannel();

export const triggerEndpoint = createTriggerEndpoint({
  onMessage: (messageId, text, history) => 
    channel.processMessage(messageId, text, history),
});

// If running standalone (not as OpenClaw plugin)
if (process.env.STANDALONE === 'true') {
  const port = parseInt(process.env.PORT || '8080');
  
  Bun.serve({
    port,
    fetch: triggerEndpoint,
  });
  
  console.log(`Firebase channel listening on port ${port}`);
}
```

---

### 8. Create Mock Services for Testing
**File:** `test/mock-services.ts`

```typescript
// Mock App Server
const appServer = Bun.serve({
  port: 3000,
  fetch: async (req) => {
    if (req.url.endsWith('/api/response')) {
      const body = await req.json();
      console.log('[MockAppServer] Received response:', body);
      return new Response(JSON.stringify({ status: 'saved' }));
    }
    return new Response('Not found', { status: 404 });
  },
});

// Mock LLM Proxy
const proxy = Bun.serve({
  port: 3001,
  fetch: async (req) => {
    if (req.url.endsWith('/v1/responses')) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const chunks = [
            'data: {"delta":{"text":"Hello "}}\n\n',
            'data: {"delta":{"text":"from "}}\n\n',
            'data: {"delta":{"text":"mock!"}}\n\n',
            'data: [DONE]\n\n',
          ];
          chunks.forEach((chunk, i) => {
            setTimeout(() => {
              controller.enqueue(encoder.encode(chunk));
              if (i === chunks.length - 1) controller.close();
            }, i * 100);
          });
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log('Mock App Server on :3000');
console.log('Mock LLM Proxy on :3001');
```

---

## Verification Checklist

- [x] Plugin builds without errors
- [x] HTTP trigger validates secret correctly
- [x] Plugin calls LLM Proxy with streaming
- [x] Plugin parses SSE stream correctly
- [x] Plugin sends response back to App Server
- [x] Billing errors are handled (402 → purchase_credits action)
- [x] General errors return friendly message

## Testing

```bash
# Terminal 1: Start mock services
bun run test/mock-services.ts

# Terminal 2: Start plugin
VM_INTERNAL_SECRET=sec_test \
LLM_PROXY_URL=http://localhost:3001 \
LLM_PROXY_API_KEY=pxy_test \
APP_SERVER_URL=http://localhost:3000 \
STANDALONE=true \
bun run index.ts

# Terminal 3: Trigger a message
curl -X POST http://localhost:8080/api/message \
  -H "Authorization: Bearer sec_test" \
  -H "Content-Type: application/json" \
  -d '{"messageId": "test123", "text": "Hello AI"}'
```

## Integration with OpenClaw

Once the standalone plugin works, integrate it with OpenClaw's channel system:

1. Register the channel in OpenClaw's config
2. Configure environment variables
3. Test full flow: App Server → VM → LLM Proxy → VM → App Server

---

## Done Criteria

This stream is **COMPLETE** when:

1. All verification checklist items pass
2. Can run entirely with mock services (no real App Server or Proxy needed)
3. SSE parsing works for both Anthropic and OpenAI formats
4. Billing errors (402) are correctly detected and handled
5. Response is sent back to App Server mock

## Integration Handoff

When integrating with other streams:

- **Stream A (Proxy)** will receive `POST /v1/responses` calls from this plugin
- **Stream B (App Server)** will trigger this plugin via `POST /api/message` and receive responses via `POST /api/response`

For real integration:
1. Deploy with real environment variables
2. Ensure VM has `LLM_PROXY_API_KEY` and `VM_INTERNAL_SECRET` set as Fly.io secrets
3. No code changes needed - just configuration
