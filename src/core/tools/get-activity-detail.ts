// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";

export function registerGetActivityDetail(server: McpServer): void {
  server.registerTool(
    "get_activity_detail",
    {
      title: "Get Activity Detail",
      description:
        "Fetch complete data for a single Intervals.icu activity, including " +
        "power/HR zone distributions (icu_zone_times, icu_hr_zone_times), " +
        "Stryd metrics (StrydLBSSmod, StrydILR), decoupling, and all other fields. " +
        "Use get_activities first to find the activity_id.",
      inputSchema: {
        activity_id: z
          .string()
          .min(1)
          .refine(
            (s) => !/\s/.test(s) && !/[^\x20-\x7E]/.test(s),
            "This looks like an activity name, not an ID. " +
            "Call get_activities first to get the activity_id field (e.g. 'i12345678')."
          )
          .describe(
            "Intervals.icu activity ID — a short alphanumeric string like 'i12345678', " +
            "NOT the activity name. Call get_activities first to obtain IDs."
          ),
      },
    },
    async ({ activity_id }) => {
      const activity = await intervalsClient.getActivityDetail(activity_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(activity, null, 2),
          },
        ],
      };
    }
  );
}
