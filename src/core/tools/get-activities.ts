// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";
import type { Activity } from "../types.js";

/** Fields omitted from list responses to keep token usage low. */
const EXCLUDED_FIELDS = new Set([
  "stream_types",
  "laps",
  "efforts",
  "segments",
  "icu_streams",
]);

function stripLargeFields(activity: Activity): Partial<Activity> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(activity)) {
    if (!EXCLUDED_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result as Partial<Activity>;
}

/** Summary fields for screening — keeps payload small for long date ranges. */
const SUMMARY_FIELDS = new Set([
  "id",
  "name",
  "type",
  "start_date_local",
  "moving_time",
  "distance",
  "icu_training_load",
  "StrydLBSSmod",
  "total_elevation_gain",
]);

function toSummary(activity: Activity): Partial<Activity> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(activity)) {
    if (SUMMARY_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result as Partial<Activity>;
}

export function registerGetActivities(server: McpServer): void {
  server.registerTool(
    "get_activities",
    {
      title: "Get Activities",
      description:
        "Fetch a list of Intervals.icu activities for a date range. " +
        "Default 'summary' mode returns only 9 key fields (id, name, type, date, time, distance, RSS, LBSS, elevation) — " +
        "use this for screening and obtaining activity IDs. " +
        "Set fields='full' for all fields (large objects still excluded). " +
        "For filtered searches with aggregate stats, use search_similar_activities instead.",
      inputSchema: {
        oldest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Start date (inclusive), YYYY-MM-DD"),
        newest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("End date (inclusive), YYYY-MM-DD"),
        fields: z
          .enum(["summary", "full"])
          .default("summary")
          .describe(
            'Field set to return. ' +
            '"summary" (default): id, name, type, start_date_local, moving_time, distance, ' +
            'icu_training_load, StrydLBSSmod, total_elevation_gain — compact for screening. ' +
            '"full": all fields except internal large objects (laps, streams, etc).'
          ),
        type: z
          .string()
          .optional()
          .describe('Filter by activity type, e.g. "Run", "VirtualRun", "Ride". Case-sensitive, exact match.'),
      },
    },
    async ({ oldest, newest, fields, type }) => {
      // Zod default may not apply via MCP transport
      const fieldSet = fields ?? "summary";

      const raw = await intervalsClient.getActivities(oldest, newest);
      let activities = raw as Activity[];

      // Apply type filter (client-side — Intervals.icu API has no server-side filter)
      if (type) {
        activities = activities.filter((a) => a.type === type);
      }

      // Apply field projection
      const projected = fieldSet === "summary"
        ? activities.map(toSummary)
        : activities.map(stripLargeFields);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(projected, null, 2),
          },
        ],
      };
    }
  );
}
