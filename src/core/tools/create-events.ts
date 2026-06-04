// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";

const eventSchema = z.object({
  name: z.string().describe("Event name (e.g., 'Easy 60min', 'SSR Long Run 32km')"),
  start_date_local: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS")
    .describe("Date (or datetime) in local timezone. Time is optional; omit for all-day."),
  category: z
    .enum(["WORKOUT", "NOTE", "RACE_A", "RACE_B", "RACE_C"])
    .default("WORKOUT")
    .describe("Event category. RACE_A/B/C = race priority (A=primary goal race)"),
  type: z
    .string()
    .optional()
    .describe("Sport type — required for WORKOUT (e.g., 'Run', 'Ride', 'Swim')"),
  description: z
    .string()
    .optional()
    .describe("Free-text description: workout structure, zone targets, notes"),
  load_target: z.number().optional().describe("Planned RSS load target"),
  moving_time: z.number().optional().describe("Planned duration in seconds"),
});

export function registerCreateEvents(server: McpServer): void {
  server.registerTool(
    "create_events",
    {
      title: "Create Events",
      description:
        "Create one or more calendar events (planned workouts, races, notes) on Intervals.icu. " +
        "Accepts a single event or an array for batch creation (e.g., a full week of planned training). " +
        "Returns the created event(s) with their assigned IDs.",
      inputSchema: {
        events: z
          .array(eventSchema)
          .min(1)
          .max(14)
          .describe("Array of events to create (1–14). Use for batch loading a week or two of planned training."),
      },
    },
    async ({ events }) => {
      const results = [];
      const errors = [];
      for (const event of events) {
        try {
          // API requires datetime format — auto-append T00:00:00 for date-only input
          const input = {
            ...event,
            start_date_local: event.start_date_local.includes("T")
              ? event.start_date_local
              : `${event.start_date_local}T00:00:00`,
          };
          const created = await intervalsClient.createEvent(input);
          results.push(created);
        } catch (e) {
          errors.push({ event: event.name, date: event.start_date_local, error: String(e) });
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ created: results, errors }, null, 2),
          },
        ],
      };
    }
  );
}
