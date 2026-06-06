// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCP transport adapter for ToolDef (Stage 2 Phase 0).
 *
 * Registers a ToolDef on an McpServer: advertises the schema to clients
 * (unchanged), applies defaults/validation via `z.object(schema).parseAsync`,
 * runs the raw-data handler, and wraps the result in the MCP text content
 * envelope with pretty (null, 2) printing — identical to the legacy path.
 *
 * Transport-free w.r.t. the app: imports only the SDK + zod, never express
 * or src/index.ts.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDef } from "../tool-registry.js";

type McpHandlerExtra = {
  signal?: AbortSignal;
  requestId?: string | number;
};

function requestIdLabel(extra: McpHandlerExtra | undefined): string {
  return extra?.requestId === undefined ? "unknown" : String(extra.requestId);
}

export function registerToolDef(server: McpServer, t: ToolDef): void {
  server.registerTool(
    t.name,
    {
      title: t.title,
      description: t.description,
      inputSchema: t.schema,
    },
    async (raw: unknown, extra?: McpHandlerExtra) => {
      const startedAt = Date.now();
      const requestId = requestIdLabel(extra);
      let cancelled = false;
      const onAbort = () => {
        cancelled = true;
        console.error(
          `[intervals-mcp-server] tool cancel name=${t.name} requestId=${requestId} elapsed_ms=${Date.now() - startedAt}`
        );
      };
      extra?.signal?.addEventListener("abort", onAbort, { once: true });
      console.error(`[intervals-mcp-server] tool start name=${t.name} requestId=${requestId}`);

      try {
        // Re-parse so Zod defaults apply (MCP transport can skip them).
        const args = await z.object(t.schema).parseAsync(raw);
        const data = await t.handler(args, { signal: extra?.signal });
        const elapsedMs = Date.now() - startedAt;
        console.error(
          `[intervals-mcp-server] tool end name=${t.name} requestId=${requestId} elapsed_ms=${elapsedMs} cancelled=${cancelled || extra?.signal?.aborted === true}`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[intervals-mcp-server] tool error name=${t.name} requestId=${requestId} elapsed_ms=${elapsedMs} message=${message}`
        );
        throw err;
      } finally {
        extra?.signal?.removeEventListener("abort", onAbort);
      }
    },
  );
}
