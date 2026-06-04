// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";

export function registerDeleteEvent(server: McpServer): void {
  server.registerTool(
    "delete_event",
    {
      title: "Delete Event",
      description:
        "Delete a calendar event from Intervals.icu. " +
        "Use get_events first to find the event ID. This action is irreversible.",
      inputSchema: {
        event_id: z.number().describe("Event ID to delete (from get_events results)"),
      },
    },
    async ({ event_id }) => {
      await intervalsClient.deleteEvent(event_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ deleted: true, event_id }, null, 2),
          },
        ],
      };
    }
  );
}
