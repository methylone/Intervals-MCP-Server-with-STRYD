// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const getAthleteSummaryTool: ToolDef = {
  name: "get_athlete_summary",
  title: "Get Athlete Summary",
  description:
    "Fetch an aggregated athlete summary for a date range from Intervals.icu. " +
    "Returns period totals and averages such as CTL/ATL/TSB, training load, " +
    "and fitness trends. Useful for a quick overview without fetching individual activities.",
  schema: {
    start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .describe("Start date (inclusive), YYYY-MM-DD"),
    end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .describe("End date (inclusive), YYYY-MM-DD"),
  },
  handler: async ({ start, end }: { start: string; end: string }, ctx?: ToolContext) => {
    return await intervalsClient.getAthleteSummary(start, end, { signal: ctx?.signal });
  },
};
