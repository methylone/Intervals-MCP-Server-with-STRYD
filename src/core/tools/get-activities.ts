// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { config_ } from "../../config.js";
import { intervalsClient } from "../intervals-client.js";
import type { Activity } from "../types.js";
import type { ToolDef, ToolContext } from "../../tool-registry.js";

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

/**
 * Static summary fields for screening — keeps payload small for long date
 * ranges. The LBSS field is appended lazily in the handler (it depends on
 * config_.lbssField, which must NOT be read at module load — that would break
 * the credential-free `cli list` / enumeration paths).
 */
const STATIC_SUMMARY_FIELDS = [
  "id",
  "name",
  "type",
  "start_date_local",
  "moving_time",
  "distance",
  "icu_training_load",
  "total_elevation_gain",
];

function toSummary(activity: Activity, fields: Set<string>): Partial<Activity> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(activity)) {
    if (fields.has(key)) {
      result[key] = value;
    }
  }
  return result as Partial<Activity>;
}

/**
 * get_activities as a transport-free ToolDef (Stage 2 Phase 0 reference migration).
 *
 * The handler returns raw data (the projected array); the transport adapters
 * own validation/defaults and output enveloping. The previous
 * `fields ?? "summary"` workaround is gone — defaults are applied by the
 * adapters' `z.object(schema).parseAsync`.
 */
export const getActivitiesTool: ToolDef = {
  name: "get_activities",
  title: "Get Activities",
  description:
    "Fetch a list of Intervals.icu activities for a date range. " +
    "Default 'summary' mode returns only 9 key fields (id, name, type, date, time, distance, RSS, LBSS, elevation) — " +
    "use this for screening and obtaining activity IDs. The LBSS field is the configured " +
    "custom field (env LBSS_FIELD, default StrydLBSSv2). " +
    "Set fields='full' for all fields (large objects still excluded). " +
    "For filtered searches with aggregate stats, use search_similar_activities instead.",
  schema: {
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
        'icu_training_load, the configured LBSS field (env LBSS_FIELD, default StrydLBSSv2), ' +
        'total_elevation_gain — compact for screening. ' +
        '"full": all fields except internal large objects (laps, streams, etc).'
      ),
    type: z
      .string()
      .optional()
      .describe('Filter by activity type, e.g. "Run", "VirtualRun", "Ride". Case-sensitive, exact match.'),
  },
  handler: async ({ oldest, newest, fields, type }: {
    oldest: string;
    newest: string;
    fields: "summary" | "full";
    type?: string;
  }, ctx?: ToolContext) => {
    const raw = await intervalsClient.getActivities(oldest, newest, { signal: ctx?.signal });
    let activities = raw as Activity[];

    // Apply type filter (client-side — Intervals.icu API has no server-side filter)
    if (type) {
      activities = activities.filter((a) => a.type === type);
    }

    // Apply field projection — return raw data; adapters wrap it.
    // The summary whitelist is composed lazily here so config_ (and thus
    // credential validation) is only touched when the tool actually runs.
    const projected = fields === "summary"
      ? (() => {
          const summaryFields = new Set([...STATIC_SUMMARY_FIELDS, config_.lbssField]);
          return activities.map((a) => toSummary(a, summaryFields));
        })()
      : activities.map(stripLargeFields);

    return projected;
  },
};
