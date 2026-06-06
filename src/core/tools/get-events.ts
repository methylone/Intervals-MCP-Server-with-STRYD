// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const getEventsTool: ToolDef = {
  name: "get_events",
  title: "Get Events",
  description:
    "Fetch calendar events (planned workouts, races, notes) from Intervals.icu for a date range. " +
    "Use this to retrieve the training plan and compare planned vs actual training. " +
    "Each event includes name, category, date, and optional load_target.",
  schema: {
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
  handler: async ({ oldest, newest, category }: {
    oldest: string;
    newest: string;
    category?: "WORKOUT" | "NOTE" | "RACE_A" | "RACE_B" | "RACE_C";
  }, ctx?: ToolContext) => {
    const events = await intervalsClient.getEvents(oldest, newest, { signal: ctx?.signal });
    const filtered = category
      ? (events as Array<Record<string, unknown>>).filter((e) => e.category === category)
      : events;
    return filtered;
  },
};
