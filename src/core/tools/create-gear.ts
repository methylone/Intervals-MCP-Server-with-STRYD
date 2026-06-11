// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

export const createGearTool: ToolDef = {
  name: "create_gear",
  title: "Create Gear",
  writesAccount: true,
  description:
    "Create a new gear item (shoe/bike) on Intervals.icu. This WRITES to your account. " +
    "Ask the user for the model name, purchase date, and any notes before creating. " +
    "Returns the created gear object (its id is usable immediately with assign_gear). " +
    "For the new shoe's starting Critical Impact (CI), estimate it from a predecessor in the same " +
    "lineage via estimate_critical_impact, then record it in notes (see the buy/retire workflow).",
  schema: {
    name: z
      .string()
      .trim()
      .min(1, "name must be non-empty")
      .max(100)
      .describe("Gear name, e.g. 'HOKA Clifton 10 Green' (1–100 chars)."),
    type: z
      .string()
      .default("Shoes")
      .describe('Gear type — "Shoes" (default) or "Bike".'),
    purchased: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .optional()
      .describe("Purchase date YYYY-MM-DD (optional)."),
    notes: z
      .string()
      .optional()
      .describe(
        "Free-text notes (optional). CI/LBSS metadata may be stored here as a JSON string — " +
          "the server passes it through verbatim.",
      ),
  },
  // Single write — hard failure throws (Stage 2); no partial-failure envelope.
  handler: async (
    { name, type, purchased, notes }: { name: string; type: string; purchased?: string; notes?: string },
    ctx?: ToolContext,
  ) => {
    return await intervalsClient.createGear(
      { name, type, ...(purchased ? { purchased } : {}), ...(notes !== undefined ? { notes } : {}) },
      { signal: ctx?.signal },
    );
  },
};
