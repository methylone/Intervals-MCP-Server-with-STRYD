// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stage 2 Phase 0 default-application regression tests (network-free).
 *
 * Both adapters validate via `z.object(schema).parseAsync`, so an omitted
 * `fields` must resolve to "summary" on every transport. We assert:
 *   1. the schema itself applies the default,
 *   2. the CLI adapter (`runToolDef`) applies it,
 *   3. the MCP adapter (`registerToolDef`) applies it (via in-memory client).
 *
 * (2)/(3) use an echo ToolDef so no Intervals.icu network call is made.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getActivitiesTool } from "../src/core/tools/get-activities.js";
import type { ToolDef } from "../src/tool-registry.js";
import { runToolDef } from "../src/adapters/cli.js";
import { registerToolDef } from "../src/adapters/mcp.js";

const echoTool: ToolDef = {
  name: "echo",
  title: "Echo",
  description: "Returns its parsed args verbatim (test fixture).",
  schema: {
    fields: z.enum(["summary", "full"]).default("summary"),
  },
  handler: async (args: { fields: "summary" | "full" }) => args,
};

describe("ToolDef default application", () => {
  it("schema parseAsync applies fields default 'summary'", async () => {
    const args = await z
      .object(getActivitiesTool.schema)
      .parseAsync({ oldest: "2026-05-25", newest: "2026-06-05" });
    expect((args as { fields: string }).fields).toBe("summary");
  });

  it("CLI adapter runToolDef applies the omitted default", async () => {
    const out = await runToolDef(echoTool, {}, { raw: true });
    expect(JSON.parse(out)).toEqual({ fields: "summary" });
  });

  it("MCP adapter registerToolDef applies the omitted default", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerToolDef(server, echoTool);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({ name: "echo", arguments: {} });
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
      const text = content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      expect(JSON.parse(text)).toEqual({ fields: "summary" });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
