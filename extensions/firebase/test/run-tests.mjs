/**
 * Simple Node.js test runner for the Firebase plugin.
 * Run with: node test/run-tests.mjs
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test configuration
const TEST_SECRET = "sec_test_integration";
const PLUGIN_PORT = 8081;
const APP_SERVER_PORT = 3002;
const LLM_PROXY_PORT = 3003;

// Set environment variables
process.env.VM_INTERNAL_SECRET = TEST_SECRET;
process.env.APP_SERVER_URL = `http://localhost:${APP_SERVER_PORT}`;
process.env.LLM_PROXY_URL = `http://localhost:${LLM_PROXY_PORT}`;
process.env.LLM_PROXY_API_KEY = "pxy_test";

// Store received responses
const receivedResponses = [];

// Test results
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

// Import the monitor module dynamically after setting env vars
const { createStandaloneHandler } = await import("../src/monitor.js");

// Start mock servers
let mockAppServer;
let mockLlmProxy;
let pluginServer;

async function startServers() {
  // Mock App Server
  mockAppServer = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/response") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      receivedResponses.push(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "saved" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // Mock LLM Proxy
  mockLlmProxy = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"type":"content_block_delta","delta":{"text":"Test response"}}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // Plugin server
  const handler = createStandaloneHandler();
  pluginServer = createServer((req, res) => {
    handler(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  await Promise.all([
    new Promise((resolve) => mockAppServer.listen(APP_SERVER_PORT, resolve)),
    new Promise((resolve) => mockLlmProxy.listen(LLM_PROXY_PORT, resolve)),
    new Promise((resolve) => pluginServer.listen(PLUGIN_PORT, resolve)),
  ]);
}

function stopServers() {
  mockAppServer?.close();
  mockLlmProxy?.close();
  pluginServer?.close();
}

async function makeRequest(path, options = {}) {
  const url = `http://localhost:${PLUGIN_PORT}${path}`;
  const res = await fetch(url, options);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Run tests
console.log("\nFirebase Plugin Tests\n");

try {
  await startServers();
  console.log("Servers started\n");

  await test("should reject requests without authorization", async () => {
    const { status, body } = await makeRequest("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "test1", text: "Hello" }),
    });
    assertEquals(status, 401, "Status code");
    assertEquals(body.error, "Unauthorized", "Error message");
  });

  await test("should reject requests with wrong authorization", async () => {
    const { status } = await makeRequest("/api/message", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong_secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test2", text: "Hello" }),
    });
    assertEquals(status, 401, "Status code");
  });

  await test("should accept valid requests and return processing status", async () => {
    const { status, body } = await makeRequest("/api/message", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test3", text: "Hello AI" }),
    });
    assertEquals(status, 200, "Status code");
    assertEquals(body.status, "processing", "Response status");
  });

  await test("should send response to App Server after processing", async () => {
    receivedResponses.length = 0;

    await makeRequest("/api/message", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test4", text: "Hello AI" }),
    });

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert(receivedResponses.length > 0, "Should have received responses");
    const response = receivedResponses.find((r) => r.messageId === "test4");
    assert(response, "Should find response for test4");
    assertEquals(response.content, "Test response", "Response content");
  });

  await test("should reject requests with missing messageId", async () => {
    const { status, body } = await makeRequest("/api/message", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Hello" }),
    });
    assertEquals(status, 400, "Status code");
    assert(body.error.includes("messageId"), "Error should mention messageId");
  });

  await test("should reject requests with missing text", async () => {
    const { status, body } = await makeRequest("/api/message", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test5" }),
    });
    assertEquals(status, 400, "Status code");
    assert(body.error.includes("text"), "Error should mention text");
  });

  await test("should respond to health check", async () => {
    const { status, body } = await makeRequest("/health");
    assertEquals(status, 200, "Status code");
    assertEquals(body.status, "ok", "Health status");
  });

  await test("should return 404 for unknown endpoints", async () => {
    const { status } = await makeRequest("/unknown");
    assertEquals(status, 404, "Status code");
  });

} finally {
  stopServers();
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
