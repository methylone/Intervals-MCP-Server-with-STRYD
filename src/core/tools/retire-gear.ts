// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { config_ } from "../../config.js";
import { today } from "../../utils/date.js";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const retireGearTool: ToolDef = {
  name: "retire_gear",
  title: "Retire Gear",
  writesAccount: true,
  description:
    "Retire a gear item (shoe) on Intervals.icu so it stops appearing as a default assignment. " +
    "This WRITES to your account. Un-retiring is out of scope (fix a mistake in the Intervals.icu UI). " +
    "When retiring a shoe, consider carrying its Critical Impact (CI) forward to its successor " +
    "(see the buy/retire workflow: estimate_critical_impact on the retiring shoe → record on the new one). " +
    "Use list_gear for the gear_id.",
  schema: {
    gear_id: z
      .string()
      .min(1)
      .describe("Gear ID to retire (e.g. '60751'). Call list_gear first to obtain gear IDs."),
    retired: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .optional()
      .describe("Retirement date YYYY-MM-DD (optional; defaults to today)."),
  },
  // Single write — hard failure throws (Stage 2); no partial-failure envelope.
  handler: async (
    { gear_id, retired }: { gear_id: string; retired?: string },
    ctx?: ToolContext,
  ) => {
    // PR2 (v0.9.0): the gear ledger's `retired` is a datetime — append T00:00:00
    // to a date-only input. The API normalizes it to a date string in the response.
    // Default "today" uses the athlete timezone (config_.timezone), not UTC.
    const retiredDate = retired ?? today(config_.timezone);
    return await intervalsClient.updateGear(
      gear_id,
      { retired: `${retiredDate}T00:00:00` },
      { signal: ctx?.signal },
    );
  },
};
