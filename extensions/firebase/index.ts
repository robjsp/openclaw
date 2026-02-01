/**
 * OpenClaw Firebase Channel Plugin
 *
 * This plugin integrates OpenClaw with the Grio Firebase platform.
 * It provides an HTTP webhook endpoint for receiving messages from the
 * App Server and sends responses back via HTTP.
 *
 * Architecture:
 * - App Server triggers this plugin via POST /api/message
 * - Plugin calls LLM Proxy for AI response
 * - Plugin sends response back to App Server via POST /api/response
 * - App Server writes response to Firestore for client
 *
 * Key constraint: This plugin runs on untrusted VMs and has NO direct
 * Firebase/Firestore access. All database operations happen via the
 * App Server HTTP API.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { firebasePlugin } from "./src/channel.js";
import { handleFirebaseWebhookRequest } from "./src/monitor.js";
import { setFirebaseRuntime } from "./src/runtime.js";

const plugin = {
  id: "firebase",
  name: "Firebase",
  description: "OpenClaw Firebase channel plugin for Grio platform",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi): void {
    // Store runtime reference for use across plugin
    setFirebaseRuntime(api.runtime);

    // Register the channel plugin
    api.registerChannel({ plugin: firebasePlugin });

    // Register the HTTP webhook handler
    api.registerHttpHandler(handleFirebaseWebhookRequest);
  },
};

export default plugin;

// Re-export types for consumers
export type {
  VmTriggerRequest,
  VmTriggerResponse,
  VmResponseRequest,
  VmResponseAck,
  FirebaseResolvedAccount,
} from "./src/types.js";

// Re-export utilities for testing
export { callLlmProxy } from "./src/llm-client.js";
export { sendResponse, sendBillingErrorResponse, sendErrorResponse } from "./src/respond.js";
export { handleFirebaseWebhookRequest, createStandaloneHandler } from "./src/monitor.js";
export { firebasePlugin } from "./src/channel.js";
