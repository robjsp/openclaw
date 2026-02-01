/**
 * Standalone runner for the Firebase plugin.
 * Use this for development and testing without the full OpenClaw setup.
 *
 * Usage:
 *   VM_INTERNAL_SECRET=sec_test \
 *   LLM_PROXY_URL=http://localhost:3001 \
 *   LLM_PROXY_API_KEY=pxy_test \
 *   APP_SERVER_URL=http://localhost:3000 \
 *   bun run standalone.ts
 *
 * The server will:
 * - Listen on PORT (default 8080) for incoming messages
 * - Forward to LLM Proxy for AI responses
 * - Send responses back to App Server
 */

import { createServer } from "node:http";
import { createStandaloneHandler } from "./src/monitor.js";

const PORT = parseInt(process.env.PORT || "8080", 10);

// Validate required environment variables
const required = [
  "VM_INTERNAL_SECRET",
  "LLM_PROXY_API_KEY",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error(`
Usage:
  VM_INTERNAL_SECRET=sec_test \\
  LLM_PROXY_URL=http://localhost:3001 \\
  LLM_PROXY_API_KEY=pxy_test \\
  APP_SERVER_URL=http://localhost:3000 \\
  bun run standalone.ts
`);
  process.exit(1);
}

const handler = createStandaloneHandler();

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         Firebase Plugin Standalone Server Running            ║
╠══════════════════════════════════════════════════════════════╣
║  Server:          http://localhost:${PORT}                         ║
║  LLM Proxy:       ${process.env.LLM_PROXY_URL || "http://localhost:3001"}              ║
║  App Server:      ${process.env.APP_SERVER_URL || "http://localhost:3000"}              ║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                  ║
║    POST /api/message  - Receive messages from App Server     ║
║    GET  /health       - Health check                         ║
╠══════════════════════════════════════════════════════════════╣
║  Test with:                                                  ║
║    curl -X POST http://localhost:${PORT}/api/message \\            ║
║      -H "Authorization: Bearer \${VM_INTERNAL_SECRET}" \\       ║
║      -H "Content-Type: application/json" \\                   ║
║      -d '{"messageId": "test123", "text": "Hello AI"}'       ║
╚══════════════════════════════════════════════════════════════╝
`);
});

process.on("SIGINT", () => {
  console.log("\nShutting down standalone server...");
  server.close();
  process.exit(0);
});
