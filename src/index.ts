#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { config_, loadConfig } from "./config.js"; // .env 読み込みと環境変数バリデーション（最初に実行）
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { getActiveTools } from "./tool-registry.js";
import { registerToolDef } from "./adapters/mcp.js";
import { buildServerInstructions } from "./instructions.js";
import { getPackageVersion } from "./version.js";

const buildSha = process.env.BUILD_SHA ?? "unknown";

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "intervals-stryd",
      version: getPackageVersion(),
    },
    {
      instructions: buildServerInstructions(
        config_.timezone,
        config_.lbssField,
      ),
    }
  );

  // Tools are registered via the transport-free ToolDef registry. READ_ONLY
  // mode withholds the account-writing tools (getActiveTools handles the filter
  // identically for the CLI, so the two surfaces can't diverge).
  for (const t of getActiveTools()) registerToolDef(server, t);

  return server;
}

export { createServer };

// Resolve argv[1] through realpath so "run as main" is still detected when the
// process is launched via an npm/npx bin **symlink**: argv[1] is the symlink path
// while import.meta.url is the real module path, so a raw compare would be false
// and the server/CLI would silently do nothing.
const entryPath = process.argv[1];
const isMain = !!entryPath && import.meta.url === pathToFileURL(realpathSync(entryPath)).href;

if (isMain) {
  // Config is validated lazily (so the CLI can list tools without creds); the
  // server, however, needs valid credentials to be useful — fail fast with a
  // clean message instead of crashing on first lazy access deeper in startup.
  try {
    loadConfig();
  } catch (err) {
    console.error(`[config] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
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
        console.error("[intervals-stryd] Error handling POST /mcp:", err);
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
      res.json({
        status: "ok",
        transport: "http",
        uptime: process.uptime(),
        build_sha: buildSha,
      });
    });

    app.listen(config_.port, "0.0.0.0", () => {
      console.error(
        `[intervals-stryd] HTTP server listening on 0.0.0.0:${config_.port} build_sha=${buildSha}`
      );
    });
  } else {
    // stdio mode (default)
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[intervals-stryd] Server started (stdio)");
  }
}
