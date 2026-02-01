/**
 * HTTP webhook handler for receiving messages from the App Server.
 * This is the inbound leg of the App Server <-> VM communication.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { VmTriggerRequest, VmTriggerResponse } from "./types.js";
import { callLlmProxy } from "./llm-client.js";
import {
  sendResponse,
  sendBillingErrorResponse,
  sendErrorResponse,
} from "./respond.js";

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
 * Called asynchronously after acknowledging receipt.
 */
async function processMessage(request: VmTriggerRequest): Promise<void> {
  const { messageId, text, conversationHistory } = request;

  console.log(`[Firebase] Processing message ${messageId}: "${text}"`);

  // Build messages array for LLM
  const messages = [
    ...(conversationHistory || []),
    { role: "user" as const, content: text },
  ];

  // Call LLM Proxy
  const result = await callLlmProxy({ messages });

  if (!result.ok) {
    console.error(`[Firebase] LLM error for ${messageId}:`, result.error);

    if (result.isBillingError) {
      await sendBillingErrorResponse(messageId);
    } else {
      await sendErrorResponse(messageId);
    }
    return;
  }

  console.log(
    `[Firebase] LLM response for ${messageId}: ${result.content.length} chars`,
  );

  // Send response back to App Server
  await sendResponse(messageId, result.content, {
    model: "claude-sonnet-4-20250514",
    tokens: result.usage?.outputTokens,
  });
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
