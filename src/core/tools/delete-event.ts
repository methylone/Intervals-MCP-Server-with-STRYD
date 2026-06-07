// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const deleteEventTool: ToolDef = {
  name: "delete_event",
  title: "Delete Event",
  writesAccount: true,
  description:
    "Delete a calendar event from Intervals.icu. " +
    "Use get_events first to find the event ID. This action is irreversible.",
  schema: {
    event_id: z.number().describe("Event ID to delete (from get_events results)"),
  },
  handler: async ({ event_id }: { event_id: number }, ctx?: ToolContext) => {
    await intervalsClient.deleteEvent(event_id, { signal: ctx?.signal });
    return { deleted: true, event_id };
  },
};
