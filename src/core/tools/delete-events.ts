// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const deleteEventsTool: ToolDef = {
  name: "delete_events",
  title: "Delete Events",
  description:
    "Delete multiple calendar events from Intervals.icu in one call. " +
    "Use get_events first to find event IDs. This action is irreversible. " +
    "Prefer this over calling delete_event in a loop.",
  schema: {
    event_ids: z
      .array(z.number())
      .min(1)
      .max(30)
      .describe("Array of event IDs to delete (1–30). Get IDs from get_events."),
  },
  // Partial failure is returned as success data ({ deleted, errors }) — not thrown.
  handler: async ({ event_ids }: { event_ids: number[] }, ctx?: ToolContext) => {
    const results = [];
    const errors = [];
    for (const id of event_ids) {
      try {
        await intervalsClient.deleteEvent(id, { signal: ctx?.signal });
        results.push(id);
      } catch (e) {
        errors.push({ event_id: id, error: String(e) });
      }
    }
    return { deleted: results, errors };
  },
};
