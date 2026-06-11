// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import { intervalsClient } from "../intervals-client.js";

// Same negative validation the single-activity tools use, applied per element:
// reject anything with whitespace / non-ASCII (that is an activity *name*, not an ID).
const activityIdSchema = z
  .string()
  .min(1)
  .refine(
    (s) => !/\s/.test(s) && !/[^\x20-\x7E]/.test(s),
    "This looks like an activity name, not an ID. " +
      "Call get_activities first to get the activity_id field (e.g. 'i12345678').",
  );

export const assignGearTool: ToolDef = {
  name: "assign_gear",
  title: "Assign Gear",
  writesAccount: true,
  description:
    "Assign a gear item (shoe) to one or more activities on Intervals.icu. " +
    "This WRITES to your account. It is NOT irreversible — re-assigning a different gear corrects a mistake — " +
    "but there is no unassign (removing gear entirely is out of scope). " +
    "An activity already assigned to the target gear is skipped (no redundant write). " +
    "Typical flow: in a daily review, detect activities with no gear via get_activities, suggest the " +
    "recently-used shoe, confirm with the user, then assign. " +
    "Use list_gear for gear IDs and get_activities for activity IDs.",
  schema: {
    activity_ids: z
      .array(activityIdSchema)
      .min(1)
      .max(30)
      .describe(
        "Activity IDs to assign the gear to (1–30), e.g. ['i12345678']. " +
          "Call get_activities first to obtain IDs — these are NOT activity names.",
      ),
    gear_id: z
      .string()
      .min(1)
      .describe("Gear ID to assign (e.g. '60751'). Call list_gear first to obtain gear IDs."),
  },
  // Partial failure is returned as success data ({ assigned, skipped, errors }) — not thrown.
  handler: async (
    { activity_ids, gear_id }: { activity_ids: string[]; gear_id: string },
    ctx?: ToolContext,
  ) => {
    const assigned: string[] = [];
    const skipped: { activity_id: string; reason: string }[] = [];
    const errors: { activity_id: string; error: string }[] = [];

    for (const id of activity_ids) {
      try {
        // Skip guard: avoid a redundant production write when the activity is
        // already on this gear. PR1 (v0.8.0) showed a same-value reassign is
        // odometer-safe/idempotent, so this is hygiene rather than correctness —
        // but it keeps re-runs clean and populates the `skipped` bucket.
        const detail = (await intervalsClient.getActivityDetail(id, { signal: ctx?.signal })) as
          | { gear?: { id?: string | null } | null }
          | null;
        const current = detail?.gear?.id ?? null;
        if (current != null && String(current) === gear_id) {
          skipped.push({ activity_id: id, reason: "already assigned to this gear" });
          continue;
        }
        await intervalsClient.assignActivityGear(id, gear_id, { signal: ctx?.signal });
        assigned.push(id);
      } catch (e) {
        errors.push({ activity_id: id, error: String(e) });
      }
    }
    return { assigned, skipped, errors };
  },
};
