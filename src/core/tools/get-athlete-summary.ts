// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";

export function registerGetAthleteSummary(server: McpServer): void {
  server.registerTool(
    "get_athlete_summary",
    {
      title: "Get Athlete Summary",
      description:
        "Fetch an aggregated athlete summary for a date range from Intervals.icu. " +
        "Returns period totals and averages such as CTL/ATL/TSB, training load, " +
        "and fitness trends. Useful for a quick overview without fetching individual activities.",
      inputSchema: {
        start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Start date (inclusive), YYYY-MM-DD"),
        end: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("End date (inclusive), YYYY-MM-DD"),
      },
    },
    async ({ start, end }) => {
      const summary = await intervalsClient.getAthleteSummary(start, end);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );
}
