/**
 * Integration tests for the Firebase plugin.
 * Run with: bun test test/integration.test.ts
 *
 * Prerequisites:
 * - Mock services running (bun run test/mock-services.ts)
 * - Or real App Server + LLM Proxy
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createServer, type Server } from "node:http";
import { createStandaloneHandler } from "../src/monitor.js";

// Test configuration
const TEST_SECRET = "sec_test_integration";
const PLUGIN_PORT = 8081;
const APP_SERVER_PORT = 3002;
const LLM_PROXY_PORT = 3003;

// Set environment variables for tests
process.env.VM_INTERNAL_SECRET = TEST_SECRET;
process.env.APP_SERVER_URL = `http://localhost:${APP_SERVER_PORT}`;
process.env.LLM_PROXY_URL = `http://localhost:${LLM_PROXY_PORT}`;
process.env.LLM_PROXY_API_KEY = "pxy_test";

// Store received responses
const receivedResponses: Array<{ messageId: string; content: string; metadata?: unknown }> = [];

// Mock servers
let mockAppServer: ReturnType<typeof Bun.serve>;
let mockLlmProxy: ReturnType<typeof Bun.serve>;
let pluginServer: Server;

beforeAll(async () => {
  // Start mock App Server
  mockAppServer = Bun.serve({
    port: APP_SERVER_PORT,
    async fetch(req) {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/response") {
        const body = await req.json();
        receivedResponses.push(body);
        return Response.json({ status: "saved" });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  // Start mock LLM Proxy
  mockLlmProxy = Bun.serve({
    port: LLM_PROXY_PORT,
    async fetch(req) {
      if (req.method === "POST" && new URL(req.url).pathname === "/v1/responses") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Test response"}}\n\n'),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  // Start plugin server
  const handler = createStandaloneHandler();
  pluginServer = createServer((req, res) => {
    handler(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    pluginServer.listen(PLUGIN_PORT, resolve);
  });
});

afterAll(() => {
  mockAppServer?.stop();
  mockLlmProxy?.stop();
  pluginServer?.close();
});

describe("Firebase Plugin", () => {
  it("should reject requests without authorization", async () => {
    const response = await fetch(`http://localhost:${PLUGIN_PORT}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "test1", text: "Hello" }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("should reject requests with wrong authorization", async () => {
    const response = await fetch(`http://localhost:${PLUGIN_PORT}/api/message`, {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong_secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test2", text: "Hello" }),
    });

    expect(response.status).toBe(401);
  });

  it("should accept valid requests and return processing status", async () => {
    const response = await fetch(`http://localhost:${PLUGIN_PORT}/api/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test3", text: "Hello AI" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("processing");
  });

  it("should send response to App Server after processing", async () => {
    receivedResponses.length = 0; // Clear previous responses

    await fetch(`http://localhost:${PLUGIN_PORT}/api/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test4", text: "Hello AI" }),
    });

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(receivedResponses.length).toBeGreaterThan(0);
    const response = receivedResponses.find((r) => r.messageId === "test4");
    expect(response).toBeDefined();
    expect(response?.content).toBe("Test response");
  });

  it("should reject requests with missing messageId", async () => {
    const response = await fetch(`http://localhost:${PLUGIN_PORT}/api/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Hello" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("messageId");
  });

  it("should reject requests with missing text", async () => {
    const response = await fetch(`http://localhost:${PLUGIN_PORT}/api/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: "test5" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("text");
  });

  it("should respond to health check", async () => {
    const response = await fetch(`http://localhost:${PLUGIN_PORT}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  it("should return 404 for unknown endpoints", async () => {
    const response = await fetch(`http://localhost:${PLUGIN_PORT}/unknown`);
    expect(response.status).toBe(404);
  });
});
