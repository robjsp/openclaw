/**
 * Test billing error handling.
 * Run with: node test/test-billing-error.mjs
 */

import { createServer } from "node:http";

const TEST_SECRET = "sec_test_billing";
const PLUGIN_PORT = 8082;
const APP_SERVER_PORT = 3004;
const LLM_PROXY_PORT = 3005;

process.env.VM_INTERNAL_SECRET = TEST_SECRET;
process.env.APP_SERVER_URL = `http://localhost:${APP_SERVER_PORT}`;
process.env.LLM_PROXY_URL = `http://localhost:${LLM_PROXY_PORT}`;
process.env.LLM_PROXY_API_KEY = "pxy_test";

const receivedResponses = [];

const { createStandaloneHandler } = await import("../src/monitor.js");

// Mock App Server
const mockAppServer = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/response") {
    let body = "";
    for await (const chunk of req) body += chunk;
    receivedResponses.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "saved" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// Mock LLM Proxy that returns 402 billing error
const mockLlmProxy = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/responses") {
    res.writeHead(402, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        type: "billing_error",
        message: "Insufficient credits",
        code: "insufficient_credits",
      },
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// Plugin server
const handler = createStandaloneHandler();
const pluginServer = createServer((req, res) => {
  handler(req, res).catch(() => {
    res.writeHead(500);
    res.end();
  });
});

console.log("\nBilling Error Test\n");

try {
  await Promise.all([
    new Promise((resolve) => mockAppServer.listen(APP_SERVER_PORT, resolve)),
    new Promise((resolve) => mockLlmProxy.listen(LLM_PROXY_PORT, resolve)),
    new Promise((resolve) => pluginServer.listen(PLUGIN_PORT, resolve)),
  ]);

  console.log("Servers started");

  // Send a message that will trigger billing error
  const res = await fetch(`http://localhost:${PLUGIN_PORT}/api/message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messageId: "billing-test", text: "Hello" }),
  });

  console.log(`Request status: ${res.status}`);

  // Wait for async processing
  await new Promise((resolve) => setTimeout(resolve, 500));

  const response = receivedResponses.find((r) => r.messageId === "billing-test");

  if (!response) {
    console.log("✗ No response received");
    process.exit(1);
  }

  console.log("\nReceived response:");
  console.log(`  messageId: ${response.messageId}`);
  console.log(`  content: ${response.content}`);
  console.log(`  metadata: ${JSON.stringify(response.metadata)}`);

  if (response.metadata?.errorType === "billing" &&
      response.metadata?.action === "purchase_credits") {
    console.log("\n✓ Billing error handled correctly!");
    console.log("  - errorType: billing");
    console.log("  - action: purchase_credits");
  } else {
    console.log("\n✗ Billing error not handled correctly");
    process.exit(1);
  }

} finally {
  mockAppServer.close();
  mockLlmProxy.close();
  pluginServer.close();
}

console.log("\nTest passed!\n");
