/**
 * HTTP webhook handler for receiving messages from the App Server.
 * This is the inbound leg of the App Server <-> VM communication.
 * 
 * Messages are routed through OpenClaw's agent system for proper
 * conversation management, memory, and tool access.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { VmTriggerRequest, VmTriggerResponse } from "./types.js";
import type { ReplyPayload } from "openclaw/plugin-sdk";
import {
  sendResponse,
  sendBillingErrorResponse,
  sendErrorResponse,
  isBillingError,
} from "./respond.js";
import { getFirebaseRuntime, hasFirebaseRuntime } from "./runtime.js";

const VM_INTERNAL_SECRET = process.env.VM_INTERNAL_SECRET;
const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1MB

/**
 * Read and parse JSON body from an incoming HTTP request.
 */
async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let resolved = false;

    const doResolve = (
      result: { ok: true; value: unknown } | { ok: false; error: string },
    ) => {
      if (resolved) return;
      resolved = true;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.removeAllListeners("error");
      resolve(result);
    };

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        doResolve({ ok: false, error: "payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          doResolve({ ok: false, error: "empty payload" });
          return;
        }
        doResolve({ ok: true, value: JSON.parse(raw) });
      } catch (err) {
        doResolve({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    req.on("error", (err) => {
      doResolve({ ok: false, error: err.message });
    });
  });
}

/**
 * Send a JSON response.
 */
function sendJsonResponse(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Process an incoming message from the App Server.
 * Routes through OpenClaw's agent system using the dispatcher pattern.
 * Called asynchronously after acknowledging receipt.
 */
async function processMessage(request: VmTriggerRequest): Promise<void> {
  const { messageId, text, uid, conversationHistory } = request;

  console.log(`[Firebase] Processing message ${messageId} from user ${uid || "unknown"}: "${text}"`);
  
  if (conversationHistory && conversationHistory.length > 0) {
    console.log(`[Firebase] Received ${conversationHistory.length} previous messages for context`);
  }

  // Check if runtime is available
  if (!hasFirebaseRuntime()) {
    console.error(`[Firebase] Runtime not initialized - cannot process message ${messageId}`);
    await sendErrorResponse(
      messageId,
      "Service temporarily unavailable. Please try again."
    );
    return;
  }

  try {
    const runtime = getFirebaseRuntime();
    const cfg = runtime.config.loadConfig();

    // Resolve user ID and session key
    const userId = uid || "anonymous";

    // Resolve agent route
    const route = runtime.channel.routing.resolveAgentRoute({
      cfg,
      channel: "firebase",
      accountId: "default",
    });

    console.log(`[Firebase] Resolved route - agent: ${route.agentId}, session: ${route.sessionKey}`);

    // Build inbound context payload (similar to WhatsApp pattern)
    const ctx = runtime.channel.reply.finalizeInboundContext({
      Body: text,
      RawBody: text,
      CommandBody: text,
      From: userId,
      To: "firebase-assistant",
      SessionKey: route.sessionKey,
      AccountId: "default",
      MessageSid: messageId,
      Provider: "firebase",
      Surface: "firebase",
      OriginatingChannel: "firebase",
      ChatType: "direct",
      ConversationLabel: userId,
    });

    console.log(`[Firebase] Routing message ${messageId} through agent dispatcher`);

    // Collect response blocks
    let fullResponse = "";
    let responseMetadata: Record<string, any> = {};

    // Create a reply dispatcher with delivery callbacks
    const dispatcher = runtime.channel.reply.createReplyDispatcherWithTyping({
      // Deliver callback - handles each response block
      deliver: async (payload: ReplyPayload, info: any) => {
        // Accumulate text blocks
        if (payload.text) {
          fullResponse += payload.text;
        }

        // Log progress
        if (info.kind === "final") {
          console.log(`[Firebase] Final block received: ${fullResponse.length} chars`);
        } else if (info.kind === "tool") {
          console.log(`[Firebase] Tool block: ${payload.text?.substring(0, 100) || "N/A"}`);
        }
      },
      // Error callback
      onError: (err: any, info: any) => {
        const label = info.kind === "tool" ? "tool update" : 
                     info.kind === "block" ? "block update" : "reply";
        console.error(`[Firebase] Error delivering ${label}:`, err);
      },
    });

    // Dispatch through agent using dispatchReplyFromConfig
    await runtime.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg,
      dispatcher: dispatcher.dispatcher,
      replyOptions: {
        // Disable block streaming for Firebase (we accumulate and send once)
        disableBlockStreaming: true,
        ...dispatcher.replyOptions,
      },
    });

    if (!fullResponse || fullResponse.length === 0) {
      console.log(`[Firebase] No reply generated for ${messageId} (silent token or no content)`);
      // Don't send error - this might be intentional (e.g., command response)
      return;
    }

    console.log(`[Firebase] Agent response complete: ${fullResponse.length} chars`);

    // Send accumulated response back to App Server
    await sendResponse(messageId, fullResponse, responseMetadata);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Firebase] Failed to process message ${messageId}:`, error);

    // Check if it's a billing error
    if (isBillingError(errorMessage)) {
      await sendBillingErrorResponse(messageId);
    } else {
      await sendErrorResponse(messageId);
    }
  }
}

/**
 * Handle incoming HTTP requests from the App Server.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleFirebaseWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Health check endpoint (works in both standalone and gateway mode)
  if (req.method === "GET" && url.pathname === "/health") {
    sendJsonResponse(res, 200, { status: "ok", plugin: "firebase" });
    return true;
  }

  // Only handle POST /api/message
  if (req.method !== "POST" || url.pathname !== "/api/message") {
    return false;
  }

  // Validate authorization
  const authHeader = req.headers.authorization;
  if (!VM_INTERNAL_SECRET) {
    console.error("[Firebase] VM_INTERNAL_SECRET not configured");
    sendJsonResponse(res, 500, { error: "Server misconfigured" });
    return true;
  }

  if (authHeader !== `Bearer ${VM_INTERNAL_SECRET}`) {
    sendJsonResponse(res, 401, { error: "Unauthorized" });
    return true;
  }

  // Parse request body
  const bodyResult = await readJsonBody(req, MAX_PAYLOAD_BYTES);
  if (!bodyResult.ok) {
    sendJsonResponse(res, 400, { error: bodyResult.error });
    return true;
  }

  const body = bodyResult.value as VmTriggerRequest;

  // Validate required fields
  if (!body.messageId || typeof body.messageId !== "string") {
    sendJsonResponse(res, 400, { error: "Missing or invalid messageId" });
    return true;
  }
  if (!body.text || typeof body.text !== "string") {
    sendJsonResponse(res, 400, { error: "Missing or invalid text" });
    return true;
  }

  // Acknowledge receipt immediately
  const response: VmTriggerResponse = { status: "processing" };
  sendJsonResponse(res, 200, response);

  // Process message asynchronously
  processMessage(body).catch((err) => {
    console.error(`[Firebase] Failed to process message ${body.messageId}:`, err);
  });

  return true;
}

/**
 * Create an HTTP request handler for standalone mode.
 */
export function createStandaloneHandler(): (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> {
  return async (req, res) => {
    const handled = await handleFirebaseWebhookRequest(req, res);
    if (!handled) {
      // Health check endpoint
      if (req.method === "GET" && req.url === "/health") {
        sendJsonResponse(res, 200, { status: "ok" });
        return;
      }

      sendJsonResponse(res, 404, { error: "Not found" });
    }
  };
}
