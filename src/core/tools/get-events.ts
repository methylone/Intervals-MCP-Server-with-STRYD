// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";

export function registerGetEvents(server: McpServer): void {
  server.registerTool(
    "get_events",
    {
      title: "Get Events",
      description:
        "Fetch calendar events (planned workouts, races, notes) from Intervals.icu for a date range. " +
        "Use this to retrieve the training plan and compare planned vs actual training. " +
        "Each event includes name, category, date, and optional load_target.",
      inputSchema: {
        oldest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Start date (inclusive), YYYY-MM-DD"),
        newest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("End date (inclusive), YYYY-MM-DD"),
        category: z
          .enum(["WORKOUT", "NOTE", "RACE_A", "RACE_B", "RACE_C"])
          .optional()
          .describe("Filter by category. Omit to return all categories."),
      },
    },
    async ({ oldest, newest, category }) => {
      const events = await intervalsClient.getEvents(oldest, newest);
      const filtered = category
        ? (events as Array<Record<string, unknown>>).filter((e) => e.category === category)
        : events;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    }
  );
}
