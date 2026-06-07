// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const updateEventTool: ToolDef = {
  name: "update_event",
  title: "Update Event",
  writesAccount: true,
  description:
    "Update an existing calendar event on Intervals.icu. " +
    "Use get_events first to find the event ID. " +
    "Only include fields you want to change.",
  schema: {
    event_id: z.number().describe("Event ID (from get_events results)"),
    name: z.string().optional().describe("New event name"),
    start_date_local: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/)
      .optional()
      .describe("New date/datetime"),
    category: z.enum(["WORKOUT", "NOTE", "RACE_A", "RACE_B", "RACE_C"]).optional(),
    type: z.string().optional().describe("Sport type (e.g., 'Run', 'Ride')"),
    description: z.string().optional().describe("New description"),
    load_target: z.number().optional(),
    moving_time: z.number().optional().describe("Duration in seconds"),
  },
  handler: async ({ event_id, ...updates }: {
    event_id: number;
    [key: string]: unknown;
  }, ctx?: ToolContext) => {
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    // API requires datetime format — auto-append T00:00:00 for date-only input
    if (typeof cleanUpdates.start_date_local === "string" && !cleanUpdates.start_date_local.includes("T")) {
      cleanUpdates.start_date_local = `${cleanUpdates.start_date_local}T00:00:00`;
    }
    return await intervalsClient.updateEvent(event_id, cleanUpdates, { signal: ctx?.signal });
  },
};
