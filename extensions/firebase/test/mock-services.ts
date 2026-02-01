/**
 * Mock services for testing the Firebase plugin.
 * Simulates both the App Server and LLM Proxy.
 *
 * Usage:
 *   bun run test/mock-services.ts
 *
 * This starts:
 * - Mock App Server on port 3000 (receives responses from VM)
 * - Mock LLM Proxy on port 3001 (streams mock AI responses)
 */

const APP_SERVER_PORT = 3000;
const LLM_PROXY_PORT = 3001;

// Store received responses for verification
const receivedResponses: Array<{
  messageId: string;
  content: string;
  metadata?: unknown;
  receivedAt: number;
}> = [];

/**
 * Mock App Server - receives responses from the Firebase plugin
 */
const appServer = Bun.serve({
  port: APP_SERVER_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // POST /api/response - receive assistant responses
    if (req.method === "POST" && url.pathname === "/api/response") {
      try {
        const body = await req.json();
        console.log("[MockAppServer] Received response:", {
          messageId: body.messageId,
          contentLength: body.content?.length,
          metadata: body.metadata,
        });

        receivedResponses.push({
          messageId: body.messageId,
          content: body.content,
          metadata: body.metadata,
          receivedAt: Date.now(),
        });

        return Response.json({ status: "saved" });
      } catch (err) {
        console.error("[MockAppServer] Error parsing request:", err);
        return Response.json({ error: "Invalid request" }, { status: 400 });
      }
    }

    // GET /api/responses - list received responses (for debugging)
    if (req.method === "GET" && url.pathname === "/api/responses") {
      return Response.json({ responses: receivedResponses });
    }

    // GET /health - health check
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "mock-app-server" });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

/**
 * Mock LLM Proxy - streams mock AI responses
 */
const llmProxy = Bun.serve({
  port: LLM_PROXY_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // POST /v1/responses - mock LLM streaming response
    if (req.method === "POST" && url.pathname === "/v1/responses") {
      // Check for test scenarios based on auth header
      const authHeader = req.headers.get("Authorization");

      // Simulate billing error for specific test token
      if (authHeader === "Bearer pxy_billing_error_test") {
        return Response.json(
          {
            error: {
              type: "billing_error",
              message: "Insufficient credits",
              code: "insufficient_credits",
            },
          },
          { status: 402 },
        );
      }

      // Parse request to get message for context
      let userMessage = "unknown";
      try {
        const body = await req.json();
        const lastMessage = body.messages?.[body.messages.length - 1];
        if (lastMessage?.role === "user") {
          userMessage = lastMessage.content;
        }
      } catch {
        // Ignore parse errors
      }

      // Create streaming response
      const encoder = new TextEncoder();
      const responseText = `Hello! You said: "${userMessage}". I'm a mock AI response from the LLM Proxy.`;
      const words = responseText.split(" ");

      const stream = new ReadableStream({
        async start(controller) {
          // Send message_start with input token count
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "message_start",
                message: { usage: { input_tokens: 10 } },
              })}\n\n`,
            ),
          );

          // Stream each word with a small delay
          for (let i = 0; i < words.length; i++) {
            const text = i === 0 ? words[i] : ` ${words[i]}`;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "content_block_delta",
                  delta: { text },
                })}\n\n`,
              ),
            );
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          // Send message_delta with output token count
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "message_delta",
                usage: { output_tokens: words.length },
              })}\n\n`,
            ),
          );

          // Send done marker
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // GET /health - health check
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "mock-llm-proxy" });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Firebase Plugin Mock Services Running              ║
╠══════════════════════════════════════════════════════════════╣
║  Mock App Server:  http://localhost:${APP_SERVER_PORT}                      ║
║  Mock LLM Proxy:   http://localhost:${LLM_PROXY_PORT}                      ║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                  ║
║    App Server:                                               ║
║      POST /api/response  - Receive assistant responses       ║
║      GET  /api/responses - List received responses           ║
║      GET  /health        - Health check                      ║
║                                                              ║
║    LLM Proxy:                                                ║
║      POST /v1/responses  - Mock LLM streaming                ║
║      GET  /health        - Health check                      ║
╠══════════════════════════════════════════════════════════════╣
║  Test billing error: Use API key "pxy_billing_error_test"    ║
╚══════════════════════════════════════════════════════════════╝
`);

// Keep process running
process.on("SIGINT", () => {
  console.log("\nShutting down mock services...");
  appServer.stop();
  llmProxy.stop();
  process.exit(0);
});
