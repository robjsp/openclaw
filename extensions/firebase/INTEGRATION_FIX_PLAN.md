# Firebase Plugin OpenClaw Integration Fix Plan

**Date**: February 2, 2026  
**Status**: Planning Phase

---

## Problem Statement

The Firebase plugin is currently **bypassing OpenClaw's assistant infrastructure entirely**, acting as a simple HTTP passthrough that directly calls the LLM Proxy → Anthropic API → returns raw response.

This means we're losing:
- ❌ OpenClaw's agent/assistant capabilities
- ❌ Memory and state management
- ❌ Tool calling capabilities
- ❌ Conversation history management
- ❌ Prompt engineering and system prompts
- ❌ Access to OpenClaw's command system
- ❌ Proper session management

**Current Flow (Broken):**
```
Webhook → Firebase Plugin → LLM Proxy → Anthropic → Response → App Server → Firestore
          (No OpenClaw Agent)
```

**Correct Flow (Like WhatsApp):**
```
Webhook → Firebase Plugin → OpenClaw Agent → LLM Provider → Agent Processing → Response → App Server → Firestore
          (Full Assistant Integration)
```

---

## Root Cause Analysis

### What Went Wrong

**File**: `openclaw/extensions/firebase/src/monitor.ts`

The `processMessage()` function (lines 89-123) directly:
1. Receives message
2. Calls `callLlmProxy()` which hits Anthropic directly (line 101)
3. Posts response back to App Server (line 119)

This completely bypasses OpenClaw's `dispatchReplyWithBufferedBlockDispatcher()` which is responsible for routing messages through the agent system.

### How WhatsApp Does It Correctly

**Reference**: `openclaw/src/web/auto-reply/monitor/process-message.ts`

WhatsApp plugin:
1. Receives message from WhatsApp Web
2. Builds proper context payload (`finalizeInboundContext()` - line 272)
3. Calls `dispatchReplyWithBufferedBlockDispatcher()` (line 337)
4. This routes through OpenClaw's agent which:
   - Manages conversation state
   - Calls LLM with proper system prompts
   - Handles tool calls
   - Manages memory
5. Agent's response is delivered back to WhatsApp

---

## Architecture Comparison

### Current Firebase Plugin Architecture

```typescript
// monitor.ts - processMessage()
async function processMessage(request: VmTriggerRequest): Promise<void> {
  const messages = [
    ...(conversationHistory || []),
    { role: "user" as const, content: text },
  ];

  // WRONG: Direct LLM call bypasses OpenClaw agent
  const result = await callLlmProxy({ messages });
  
  // Send raw response back
  await sendResponse(messageId, result.content, {...});
}
```

### How It Should Work (Like WhatsApp)

```typescript
// Should route through OpenClaw's agent system
async function processMessage(request: VmTriggerRequest, runtime: PluginRuntime): Promise<void> {
  // 1. Build proper context payload
  const ctx = finalizeInboundContext({
    Body: text,
    From: userId,
    SessionKey: conversationId,
    Provider: "firebase",
    // ... other context fields
  });

  // 2. Route through OpenClaw's agent
  const { queuedFinal } = await dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg: runtime.config,
    replyResolver: runtime.replyResolver,
    // ... dispatcher options
  });

  // 3. Agent handles LLM calls, tools, memory, etc.
  // 4. Deliver agent's response
  for await (const block of queuedFinal) {
    if (block.type === 'text') {
      await sendResponse(messageId, block.content, {...});
    }
  }
}
```

---

## Implementation Plan

### Phase 1: Add Runtime Infrastructure ✅

**Files to Create/Modify:**
- `extensions/firebase/src/runtime.ts` (create)
- `extensions/firebase/src/channel.ts` (modify)

**Tasks:**

1. **Create Runtime Module** (similar to WhatsApp)
   ```typescript
   // src/runtime.ts
   import type { PluginRuntime } from "openclaw/plugin-sdk";

   let runtime: PluginRuntime | null = null;

   export function setFirebaseRuntime(next: PluginRuntime) {
     runtime = next;
   }

   export function getFirebaseRuntime(): PluginRuntime {
     if (!runtime) {
       throw new Error("Firebase runtime not initialized");
     }
     return runtime;
   }
   ```

2. **Add Runtime Injection in Channel Plugin**
   ```typescript
   // src/channel.ts
   import { setFirebaseRuntime } from "./runtime.js";

   export const firebasePlugin: ChannelPlugin<FirebaseResolvedAccount> = {
     id: "firebase",
     // ... existing config
     
     // Add init hook
     init: (runtime: PluginRuntime) => {
       setFirebaseRuntime(runtime);
     },
   };
   ```

### Phase 2: Refactor Message Processing

**Files to Modify:**
- `extensions/firebase/src/monitor.ts` (major refactor)
- `extensions/firebase/src/types.ts` (add new types)

**Tasks:**

1. **Add Required Imports**
   ```typescript
   import {
     finalizeInboundContext,
     dispatchReplyWithBufferedBlockDispatcher,
     type InboundContext,
   } from "openclaw/plugin-sdk";
   import { getFirebaseRuntime } from "./runtime.js";
   ```

2. **Refactor `processMessage()` Function**
   
   **Current (~35 lines):**
   - Builds simple messages array
   - Calls LLM directly
   - Returns raw response

   **New (~100-150 lines):**
   - Build rich context payload with all metadata
   - Route through OpenClaw agent dispatcher
   - Handle streaming response blocks
   - Proper error handling with agent context

3. **Build Context Payload**
   ```typescript
   async function processMessage(
     request: VmTriggerRequest,
     route: AgentRoute
   ): Promise<void> {
     const runtime = getFirebaseRuntime();
     const cfg = runtime.config;

     // Build context similar to WhatsApp
     const ctx = finalizeInboundContext({
       Body: request.text,
       RawBody: request.text,
       From: route.userId,
       To: "firebase-bot",
       SessionKey: route.sessionKey,
       AccountId: route.accountId,
       MessageSid: request.messageId,
       Provider: "firebase",
       Surface: "firebase",
       OriginatingChannel: "firebase",
       ChatType: "direct", // Firebase is always direct messages
       ConversationLabel: route.userId,
     });

     // Add conversation history if provided
     if (request.conversationHistory) {
       // Convert to OpenClaw history format
       ctx.History = buildHistoryFromMessages(
         request.conversationHistory
       );
     }

     // Route through agent
     const { queuedFinal } = await dispatchReplyWithBufferedBlockDispatcher({
       ctx,
       cfg,
       replyResolver: runtime.replyResolver,
       dispatcherOptions: {
         // Configure as needed
       },
     });

     // Collect response blocks
     let fullResponse = '';
     for await (const block of queuedFinal) {
       if (block.type === 'text') {
         fullResponse += block.content;
       } else if (block.type === 'media') {
         // Handle media if needed
       }
     }

     // Send back to App Server
     await sendResponse(request.messageId, fullResponse, {
       model: ctx.ModelUsed,
       tokens: ctx.TokensUsed,
     });
   }
   ```

4. **Add Agent Route Resolution**
   ```typescript
   interface AgentRoute {
     agentId: string;
     sessionKey: string;
     mainSessionKey: string;
     accountId: string;
     userId: string;
   }

   async function resolveAgentRoute(
     request: VmTriggerRequest,
     cfg: OpenClawConfig
   ): Promise<AgentRoute> {
     // Extract user ID from request
     const userId = request.uid || "default";
     
     // Build session key (conversation ID)
     const sessionKey = `firebase:${userId}`;
     
     return {
       agentId: cfg.agent?.id || "default",
       sessionKey,
       mainSessionKey: sessionKey,
       accountId: "default",
       userId,
     };
   }
   ```

### Phase 3: Update Request Types

**File**: `extensions/firebase/src/types.ts`

**Tasks:**

1. **Add User ID to Request**
   ```typescript
   export interface VmTriggerRequest {
     messageId: string;
     text: string;
     conversationHistory?: LlmMessage[];
     uid?: string; // Add user ID for session management
   }
   ```

2. **Update App Server to Send UID**
   
   **File**: `server/app/src/routes/message.ts` (line 86-88)
   ```typescript
   await vmManager.trigger(vmAppName, messageRef.id, body.text, uid); // Add uid
   ```

   **File**: `server/app/src/services/vm-manager.ts` (DaytonaVmManager.trigger)
   ```typescript
   async trigger(
     vmAppName: string, 
     messageId: string, 
     text: string,
     uid: string  // Add parameter
   ): Promise<void> {
     const payload: VmTriggerRequest = {
       messageId,
       text,
       conversationHistory: [], // TODO: Load from Firestore
       uid, // Include user ID
     };
     // ... rest of trigger logic
   }
   ```

### Phase 4: Remove Direct LLM Client

**Files to Delete/Deprecate:**
- `extensions/firebase/src/llm-client.ts` (can be deleted)

**Rationale:**
- OpenClaw's agent handles all LLM communication
- No need for custom LLM proxy client
- Agent uses configured LLM providers

**Note:** Keep LLM Proxy server (`server/proxy/`) for now as OpenClaw can use it as a provider, but the Firebase plugin shouldn't call it directly.

### Phase 5: Update Response Handling

**File**: `extensions/firebase/src/respond.ts`

**Tasks:**

1. **Handle Structured Response Blocks**
   ```typescript
   export async function sendAgentResponse(
     messageId: string,
     blocks: ResponseBlock[],
   ): Promise<void> {
     // Combine text blocks
     const textBlocks = blocks.filter(b => b.type === 'text');
     const content = textBlocks.map(b => b.content).join('\n\n');
     
     // Extract metadata from agent context
     const metadata = {
       model: blocks[0]?.context?.modelUsed,
       tokens: blocks[0]?.context?.tokensUsed,
     };
     
     await sendResponse(messageId, content, metadata);
   }
   ```

### Phase 6: Enable Conversation History

**Current Issue:** 
The `conversationHistory` field in `VmTriggerRequest` is always empty.

**Tasks:**

1. **Load History from Firestore**
   
   **File**: `server/app/src/routes/message.ts`
   ```typescript
   // After line 56 (after writing user message)
   
   // Load recent conversation history
   const historySnapshot = await collections
     .conversations(uid)
     .orderBy("timestamp", "desc")
     .limit(20) // Last 20 messages
     .get();
   
   const conversationHistory = historySnapshot.docs
     .reverse() // Chronological order
     .map(doc => {
       const data = doc.data();
       return {
         role: data.type === 'user' ? 'user' : 'assistant',
         content: data.content,
       };
     });
   ```

2. **Pass History to VM Trigger**
   ```typescript
   await vmManager.trigger(
     vmAppName, 
     messageRef.id, 
     body.text, 
     uid,
     conversationHistory // Add history
   );
   ```

3. **Update VM Manager Interface**
   ```typescript
   interface VmManager {
     trigger(
       vmAppName: string,
       messageId: string,
       text: string,
       uid: string,
       conversationHistory?: LlmMessage[]
     ): Promise<void>;
   }
   ```

### Phase 7: Configuration and Testing

**Tasks:**

1. **Update OpenClaw Config**
   
   **File**: Create default config in Firebase plugin
   ```typescript
   // Default agent configuration for Firebase
   export const DEFAULT_FIREBASE_CONFIG = {
     agent: {
       id: "firebase-assistant",
       model: "claude-haiku-4-5-20251001",
       systemPrompt: "You are a helpful AI assistant...",
     },
     channels: {
       firebase: {
         enabled: true,
         accounts: {
           default: {
             enabled: true,
           },
         },
       },
     },
   };
   ```

2. **Create Test Script**
   
   **File**: `extensions/firebase/test/integration-test.ts`
   ```typescript
   // Test that Firebase plugin routes through OpenClaw agent
   // Test conversation history
   // Test tool calling (if enabled)
   // Test error handling
   ```

3. **Update Daytona Sandbox Config**
   
   **File**: `server/app/src/services/vm-manager.ts` (line ~120)
   
   Ensure OpenClaw config includes proper agent setup:
   ```json
   {
     "agent": {
       "id": "firebase-assistant",
       "enabled": true
     },
     "gateway": {
       "mode": "local",
       "port": 3000
     },
     "plugins": {
       "entries": {
         "firebase": {
           "enabled": true
         }
       }
     }
   }
   ```

---

## Testing Strategy

### Unit Tests

1. **Context Building**
   - Test `finalizeInboundContext()` with Firebase-specific fields
   - Verify all required context fields are present
   - Test conversation history conversion

2. **Route Resolution**
   - Test agent route creation from request
   - Verify session key format
   - Test user ID extraction

### Integration Tests

1. **Agent Routing**
   - Send test message through webhook
   - Verify it reaches OpenClaw agent
   - Verify agent response flows back correctly

2. **Conversation History**
   - Send multiple messages
   - Verify history is maintained
   - Test history limits

3. **Error Handling**
   - Test agent errors
   - Test LLM failures
   - Test timeout handling

### End-to-End Tests

1. **Full Flow Test**
   ```bash
   # Use existing test script with agent-aware checks
   cd server
   ./scripts/test-vm-provisioning.sh
   
   # Verify:
   # - Agent receives message
   # - Agent system prompt is applied
   # - Response includes agent context
   ```

2. **Conversation Test**
   ```bash
   # Send multiple related messages
   # Verify agent maintains context
   # Check Firestore for history
   ```

---

## Migration Path

### Phase A: Preparation (No Breaking Changes)

1. Add runtime infrastructure
2. Create new `processMessageV2()` function alongside existing
3. Add feature flag in config to use v2

### Phase B: Testing (Parallel Systems)

1. Deploy both old and new systems
2. Route 10% of traffic to new system
3. Monitor for errors
4. Compare response quality

### Phase C: Cutover (Breaking Change)

1. Switch to new system for all traffic
2. Remove old `processMessage()` function
3. Delete `llm-client.ts`

### Phase D: Optimization

1. Enable tool calling
2. Add memory management
3. Optimize conversation history loading
4. Add caching

---

## Success Criteria

- [ ] Messages route through OpenClaw agent (not direct to LLM)
- [ ] Conversation history is maintained across messages
- [ ] Agent system prompts are applied
- [ ] Tool calling works (if enabled)
- [ ] Response quality matches or exceeds current system
- [ ] No increase in latency (should be similar or better)
- [ ] All existing tests pass
- [ ] Integration tests pass

---

## Risks and Mitigation

### Risk 1: Increased Latency
**Impact**: Medium  
**Probability**: Low  
**Mitigation**: 
- OpenClaw agent should be just as fast as direct LLM calls
- May actually be faster with proper caching
- Monitor latency during testing

### Risk 2: Breaking Changes
**Impact**: High  
**Probability**: Medium  
**Mitigation**:
- Use feature flag for gradual rollout
- Keep old code path during migration
- Extensive testing before cutover

### Risk 3: Configuration Complexity
**Impact**: Medium  
**Probability**: Medium  
**Mitigation**:
- Provide sensible defaults
- Document configuration clearly
- Create setup script

### Risk 4: Conversation History Performance
**Impact**: Medium  
**Probability**: Low  
**Mitigation**:
- Limit history to recent messages (20-50)
- Add caching layer
- Use Firestore compound indexes

---

## Dependencies

### Required Knowledge
- OpenClaw plugin SDK documentation
- OpenClaw agent architecture
- WhatsApp plugin as reference implementation

### Required Access
- OpenClaw source code (have it)
- Firebase plugin source (have it)
- Server source for App Server changes (have it)

### External Dependencies
- None (all changes are internal)

---

## Timeline Estimate

| Phase | Estimated Time | Complexity |
|-------|----------------|------------|
| Phase 1: Runtime Infrastructure | 1 hour | Low |
| Phase 2: Message Processing Refactor | 4-6 hours | High |
| Phase 3: Request Types | 1 hour | Low |
| Phase 4: Remove LLM Client | 30 min | Low |
| Phase 5: Response Handling | 2 hours | Medium |
| Phase 6: Conversation History | 2-3 hours | Medium |
| Phase 7: Config & Testing | 3-4 hours | Medium |
| **Total** | **13-17 hours** | - |

---

## Next Steps

1. **Review this plan** - Validate approach with team/stakeholders
2. **Set up development environment** - Ensure OpenClaw builds locally
3. **Create feature branch** - `feature/firebase-agent-integration`
4. **Start with Phase 1** - Add runtime infrastructure (smallest change)
5. **Implement incrementally** - Test each phase before moving to next
6. **Document as you go** - Update this plan with learnings

---

## References

### Code References
- **WhatsApp Plugin**: `openclaw/src/web/auto-reply/monitor/process-message.ts`
- **Plugin SDK**: `openclaw/src/plugin-sdk/` (check for exports)
- **Current Firebase Plugin**: `openclaw/extensions/firebase/src/`

### Documentation
- OpenClaw plugin development guide (if available)
- Anthropic API docs (for understanding current flow)
- Firebase/Firestore docs (for history loading)

---

## Questions to Resolve

1. **Does OpenClaw support custom LLM providers?**
   - If yes, can we configure it to use our LLM Proxy?
   - If no, do we need to switch to direct Anthropic integration?

2. **What's the preferred way to handle conversation history in OpenClaw?**
   - Does it have built-in session/memory management?
   - Or do we need to provide history in each request?

3. **Are there any Firebase-specific considerations for the agent?**
   - Should we use different system prompts?
   - Any special tool requirements?

4. **What's the expected format for the response blocks?**
   - Do we need to handle structured responses?
   - Or can we just concatenate text blocks?

---

**Document Version**: 1.0  
**Last Updated**: February 2, 2026  
**Author**: Assistant  
**Status**: Ready for Review
