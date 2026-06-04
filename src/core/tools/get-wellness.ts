// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";
import type { Activity, Wellness } from "../types.js";
import { computeNutritionDerived } from "../../utils/nutrition.js";

export function registerGetWellness(server: McpServer): void {
  server.registerTool(
    "get_wellness",
    {
      title: "Get Wellness",
      description:
        "Fetch daily wellness data for a date range from Intervals.icu. " +
        "Includes HRV (rMSSD), resting HR, sleep duration/score, " +
        "subjective wellness (soreness, fatigue, motivation, sleepQuality), " +
        "and RSS-based CTL/ATL/TSB. " +
        "IMPORTANT: All subjective fields use INVERTED 1-4 scale (1=best, 4=worst). " +
        "sleepScore (0-100) uses normal direction (higher=better). " +
        "Also returns 5 derived nutrition fields per day (cal_diet_total, " +
        "cal_diet_main_meals_complete, cal_diet_recorded_count, cal_workout_intake, " +
        "cal_intake_total) — meal kcal aggregation plus same-date activity CHO × 4. " +
        "cal_workout_intake/cal_intake_total are null ONLY when activity fetch failed " +
        "(distinct from 0, which means fetch succeeded with no activities).",
      inputSchema: {
        oldest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Start date (inclusive), YYYY-MM-DD"),
        newest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("End date (inclusive), YYYY-MM-DD"),
      },
    },
    async ({ oldest, newest }) => {
      const wellnessRaw = await intervalsClient.getWellness(oldest, newest);
      const wellness = wellnessRaw as Wellness[];

      // Fetch activities in parallel-safe but isolated manner: a failure here
      // must NOT fail the wellness response — it must propagate as null to
      // cal_workout_intake (see FR-NUTR-01 Critical Invariant).
      let activities: Activity[] | null;
      try {
        const activitiesRaw = await intervalsClient.getActivities(oldest, newest);
        activities = activitiesRaw as Activity[];

        // Warn about activities missing start_date_local — they will be
        // excluded from cal_workout_intake aggregation (no UTC fallback).
        const missingDate = activities.filter(
          (a) => typeof a.start_date_local !== "string" || a.start_date_local.length < 10
        );
        if (missingDate.length > 0) {
          const ids = missingDate.map((a) => a.id).join(", ");
          console.error(
            `[get_wellness] ${missingDate.length} activity/activities missing start_date_local, excluded: ${ids}`
          );
        }
      } catch (err) {
        activities = null;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[get_wellness] Activity fetch failed — cal_workout_intake will be null: ${msg}`
        );
      }

      const enriched = wellness.map((w) => ({
        ...w,
        ...computeNutritionDerived(w, activities),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(enriched, null, 2),
          },
        ],
      };
    }
  );
}
