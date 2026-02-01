/**
 * HTTP client for sending responses back to the Grio App Server.
 * This is the outbound leg of the VM <-> App Server communication.
 */

import type { VmResponseRequest, VmResponseAck } from "./types.js";

const APP_SERVER_URL =
  process.env.APP_SERVER_URL || "http://localhost:3000";
const VM_INTERNAL_SECRET = process.env.VM_INTERNAL_SECRET;

/**
 * Send an assistant response back to the App Server.
 * The App Server will write this to Firestore for the client to receive.
 */
export async function sendResponse(
  messageId: string,
  content: string,
  metadata?: VmResponseRequest["metadata"],
): Promise<void> {
  const body: VmResponseRequest = {
    messageId,
    content,
    metadata,
  };

  const response = await fetch(`${APP_SERVER_URL}/api/response`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VM_INTERNAL_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(
      `Failed to send response to App Server: ${response.status} - ${errorText}`,
    );
  }

  const result = (await response.json()) as VmResponseAck;
  if (result.status !== "saved") {
    throw new Error(`Unexpected response status: ${result.status}`);
  }
}

/**
 * Check if an error message indicates a billing/credits issue.
 */
export function isBillingError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("402") ||
    lower.includes("insufficient credits") ||
    lower.includes("insufficient_credits") ||
    lower.includes("billing") ||
    lower.includes("payment required")
  );
}

/**
 * Send a billing error response to the App Server.
 * This will prompt the client to show a purchase flow.
 */
export async function sendBillingErrorResponse(
  messageId: string,
): Promise<void> {
  await sendResponse(
    messageId,
    "You've run out of credits! Tap below to purchase more.",
    { errorType: "billing", action: "purchase_credits" },
  );
}

/**
 * Send a generic error response to the App Server.
 */
export async function sendErrorResponse(
  messageId: string,
  userMessage = "Sorry, something went wrong. Please try again.",
): Promise<void> {
  await sendResponse(messageId, userMessage, { errorType: "error" });
}
