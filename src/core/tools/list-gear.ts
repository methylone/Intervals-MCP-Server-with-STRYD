// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const listGearTool: ToolDef = {
  name: "list_gear",
  title: "List Gear",
  description:
    "Fetch all gear (shoes/bikes) for the athlete from Intervals.icu as a raw passthrough " +
    "(retired gear included; no filtering or reshaping — that is the caller's job). " +
    "Each item has id, name, type, retired, and odometer fields: distance is in METERS and " +
    "time in SECONDS, auto-incremented as activities are assigned to the gear. " +
    "notes may contain a JSON string with CI/LBSS metadata. " +
    "Use the id field with assign_gear to attach gear to activities.",
  schema: {},
  handler: async (_args: Record<string, never>, ctx?: ToolContext) => {
    return await intervalsClient.getGear({ signal: ctx?.signal });
  },
};
