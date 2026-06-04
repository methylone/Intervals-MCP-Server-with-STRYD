// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";

export function registerDeleteEvents(server: McpServer): void {
  server.registerTool(
    "delete_events",
    {
      title: "Delete Events",
      description:
        "Delete multiple calendar events from Intervals.icu in one call. " +
        "Use get_events first to find event IDs. This action is irreversible. " +
        "Prefer this over calling delete_event in a loop.",
      inputSchema: {
        event_ids: z
          .array(z.number())
          .min(1)
          .max(30)
          .describe("Array of event IDs to delete (1–30). Get IDs from get_events."),
      },
    },
    async ({ event_ids }) => {
      const results = [];
      const errors = [];
      for (const id of event_ids) {
        try {
          await intervalsClient.deleteEvent(id);
          results.push(id);
        } catch (e) {
          errors.push({ event_id: id, error: String(e) });
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ deleted: results, errors }, null, 2),
          },
        ],
      };
    }
  );
}
