// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";

export function registerUpdateEvent(server: McpServer): void {
  server.registerTool(
    "update_event",
    {
      title: "Update Event",
      description:
        "Update an existing calendar event on Intervals.icu. " +
        "Use get_events first to find the event ID. " +
        "Only include fields you want to change.",
      inputSchema: {
        event_id: z.number().describe("Event ID (from get_events results)"),
        name: z.string().optional().describe("New event name"),
        start_date_local: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/)
          .optional()
          .describe("New date/datetime"),
        category: z.enum(["WORKOUT", "NOTE", "RACE_A", "RACE_B", "RACE_C"]).optional(),
        type: z.string().optional().describe("Sport type (e.g., 'Run', 'Ride')"),
        description: z.string().optional().describe("New description"),
        load_target: z.number().optional(),
        moving_time: z.number().optional().describe("Duration in seconds"),
      },
    },
    async ({ event_id, ...updates }) => {
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      // API requires datetime format — auto-append T00:00:00 for date-only input
      if (typeof cleanUpdates.start_date_local === "string" && !cleanUpdates.start_date_local.includes("T")) {
        cleanUpdates.start_date_local = `${cleanUpdates.start_date_local}T00:00:00`;
      }
      const updated = await intervalsClient.updateEvent(event_id, cleanUpdates);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(updated, null, 2),
          },
        ],
      };
    }
  );
}
