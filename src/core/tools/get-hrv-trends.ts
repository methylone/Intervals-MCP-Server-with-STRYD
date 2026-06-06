// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { intervalsClient } from "../intervals-client.js";
import type { Wellness } from "../types.js";
import { addDays } from "../../utils/date.js";
import { computeHrvTrends } from "../../utils/hrv-trends.js";
import type { ToolDef, ToolContext } from "../../tool-registry.js";

export const getHrvTrendsTool: ToolDef = {
  name: "get_hrv_trends",
  title: "Get HRV Trends",
  description:
    "Calculate rolling HRV statistics (mean, SD, coefficient of variation) " +
    "for recovery trend analysis. Returns a daily time series.\n" +
    "- hrv_mean: rolling mean rMSSD (ms)\n" +
    "- hrv_sd: rolling standard deviation\n" +
    "- hrv_cv: coefficient of variation (%) — low CV (<10%) suggests stable " +
    "autonomic regulation; high CV (>15%) may indicate accumulated stress " +
    "or lifestyle perturbation\n" +
    "- rhr_mean: rolling mean resting HR (bpm)\n" +
    "- valid_days: number of days with HRV data in the window\n" +
    "Days with insufficient data (< half the window) return null values.\n" +
    "NOTE: Interpret CV alongside hrv_mean trend and rhr_mean — " +
    "do NOT use CV thresholds in isolation.",
  schema: {
    oldest: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .describe("Start date for output (inclusive), YYYY-MM-DD"),
    newest: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .describe("End date for output (inclusive), YYYY-MM-DD"),
    window_days: z
      .number()
      .int()
      .min(3)
      .max(30)
      .default(7)
      .describe(
        "Rolling window size in days (default: 7). " +
        "7 for weekly trends, 14 or 30 for longer-term stability analysis."
      ),
  },
  handler: async ({ oldest, newest, window_days }: {
    oldest: string;
    newest: string;
    window_days: number;
  }, ctx?: ToolContext) => {
    // window_days default (7) applied by the adapter's parseAsync.
    const fetchStart = addDays(oldest, -(window_days - 1));
    const rawWellness = await intervalsClient.getWellness(fetchStart, newest, { signal: ctx?.signal });
    const wellness = rawWellness as Wellness[];

    const series = computeHrvTrends(wellness, oldest, newest, window_days);

    return { window_days, series };
  },
};
