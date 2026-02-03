/**
 * Shared types for VM <-> App Server communication.
 * These types define the HTTP API contract between the Grio App Server
 * and OpenClaw VMs running on Fly.io.
 *
 * Note: VMs have NO direct Firestore access. All database operations
 * happen via HTTP calls to the App Server.
 */

/**
 * Request from App Server to VM to process a message.
 * POST /api/message on VM
 */
export interface VmTriggerRequest {
  /** Unique message ID for correlation */
  messageId: string;
  /** User's message text */
  text: string;
  /** User ID for session management and conversation context */
  uid?: string;
  /** Optional conversation history for context */
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

/**
 * Response from VM acknowledging message receipt.
 */
export interface VmTriggerResponse {
  status: "processing";
}

/**
 * Request from VM to App Server with assistant response.
 * POST /api/response on App Server
 */
export interface VmResponseRequest {
  /** Message ID this response is for */
  messageId: string;
  /** Assistant's response content */
  content: string;
  /** Optional metadata about the response */
  metadata?: {
    /** Type of error if any */
    errorType?: string;
    /** Action for client to take (e.g., 'purchase_credits') */
    action?: string;
    /** Model used for generation */
    model?: string;
    /** Tokens used */
    tokens?: number;
  };
}

/**
 * Response from App Server acknowledging response receipt.
 */
export interface VmResponseAck {
  status: "saved";
}

/**
 * Resolved Firebase account configuration.
 */
export interface FirebaseResolvedAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  appServerUrl?: string;
  llmProxyUrl?: string;
}
