// SPDX-License-Identifier: AGPL-3.0-or-later
import { config_ } from "./config.js"; // .env 読み込みと環境変数バリデーション（最初に実行）
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { registerGetActivities } from "./core/tools/get-activities.js";
import { registerGetActivityDetail } from "./core/tools/get-activity-detail.js";
import { registerGetWellness } from "./core/tools/get-wellness.js";
import { registerGetAthleteSummary } from "./core/tools/get-athlete-summary.js";
import { registerGetCurrentPmc } from "./extensions/stryd/tools/get-current-pmc.js";
import { registerGetWeeklySummary } from "./extensions/stryd/tools/get-weekly-summary.js";
import { registerGetPhaseSummary } from "./extensions/stryd/tools/get-phase-summary.js";
import { registerGetStreamsSummary } from "./core/tools/get-streams-summary.js";
import { registerSearchSimilarActivities } from "./core/tools/search-similar-activities.js";
import { registerGetEvents } from "./core/tools/get-events.js";
import { registerCreateEvents } from "./core/tools/create-events.js";
import { registerUpdateEvent } from "./core/tools/update-event.js";
import { registerDeleteEvent } from "./core/tools/delete-event.js";
import { registerDeleteEvents } from "./core/tools/delete-events.js";
import { registerGetHrvTrends } from "./core/tools/get-hrv-trends.js";
import { registerClearCache } from "./core/tools/clear-cache.js";
import { registerSetCacheEnabled } from "./core/tools/set-cache-enabled.js";
import { buildServerInstructions } from "./instructions.js";

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "intervals-mcp-server",
      version: "0.1.0",
    },
    {
      instructions: buildServerInstructions(config_.timezone),
    }
  );

  // Core tools
  registerGetActivities(server);
  registerGetActivityDetail(server);
  registerGetWellness(server);
  registerGetAthleteSummary(server);
  registerGetStreamsSummary(server);
  registerSearchSimilarActivities(server);
  registerGetEvents(server);
  registerCreateEvents(server);
  registerUpdateEvent(server);
  registerDeleteEvent(server);
  registerDeleteEvents(server);
  registerGetHrvTrends(server);
  registerClearCache(server);
  registerSetCacheEnabled(server);

  // Stryd extension tools
  registerGetCurrentPmc(server);
  registerGetWeeklySummary(server);
  registerGetPhaseSummary(server);

  return server;
}

if (config_.transport === "http") {
  const app = express();
  app.use(express.json());

  // Map to store transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };
        const server = createServer();
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[intervals-mcp-server] Error handling POST /mcp:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Bad Request: Missing or invalid session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Bad Request: Missing or invalid session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "http", uptime: process.uptime() });
  });

  app.listen(config_.port, "0.0.0.0", () => {
    console.error(`[intervals-mcp-server] HTTP server listening on 0.0.0.0:${config_.port}`);
  });
} else {
  // stdio mode (default)
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[intervals-mcp-server] Server started (stdio)");
}
