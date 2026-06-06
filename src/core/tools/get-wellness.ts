// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";
import type { Wellness } from "../types.js";

export const getWellnessTool: ToolDef = {
  name: "get_wellness",
  title: "Get Wellness",
  description:
    "Fetch daily wellness data for a date range from Intervals.icu. " +
    "Includes HRV (rMSSD), resting HR, sleep duration/score, " +
    "subjective wellness (soreness, fatigue, motivation, sleepQuality), " +
    "and RSS-based CTL/ATL/TSB. " +
    "IMPORTANT: All subjective fields use INVERTED 1-4 scale (1=best, 4=worst). " +
    "sleepScore (0-100) uses normal direction (higher=better).",
  schema: {
    oldest: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .describe("Start date (inclusive), YYYY-MM-DD"),
    newest: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .describe("End date (inclusive), YYYY-MM-DD"),
  },
  handler: async ({ oldest, newest }: { oldest: string; newest: string }, ctx?: ToolContext) => {
    const wellnessRaw = await intervalsClient.getWellness(oldest, newest, { signal: ctx?.signal });
    return wellnessRaw as Wellness[];
  },
};
