// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCP tool: update_lbss_ci_table (v0.10.0, #18 Phase C)
 *
 * The highest-risk write in the project: it rewrites the per-shoe Critical Impact
 * table embedded in the LBSS custom-field scripts. Three safety layers:
 *  1. Structural — only the single managed `let CI_TABLE = {...};` line between the
 *     sentinel markers is rewritten, machine-generated from validated numbers
 *     (see ci-table.ts). A syntax error is structurally impossible.
 *  2. dry-run default — nothing is written unless apply:true. dry-run returns the
 *     per-field current/proposed table and the before/after managed line.
 *  3. Both-fields-or-none — CI must stay equal across the LBSS field and the Ecc
 *     field (a script-backup operational constraint). The tool updates LBSS_FIELD
 *     and ECC_FIELD (when non-empty) together; if either field's script hasn't
 *     adopted the sentinel contract, NOTHING is written (no CI divergence).
 */
import { z } from "zod";
import { config_ } from "../../../config.js";
import { intervalsClient } from "../../../core/intervals-client.js";
import { prepareCiTableUpdate, type CiTableInput } from "../ci-table.js";
import type { ToolDef, ToolContext } from "../../../tool-registry.js";

type CustomItem = {
  id: number | string;
  name?: string;
  content?: ({ code?: string; script?: string } & Record<string, unknown>) | null;
};

/**
 * Resolve which field Codes to update. CI must stay identical across the LBSS
 * field and the Ecc field, so both are targeted — unless ECC_FIELD is "" (Ecc
 * disabled), in which case only the LBSS field is updated. Pure (config read
 * happens in the handler) so the both-or-single branch is unit-testable.
 */
export function resolveTargetCodes(
  lbssField: string,
  eccField: string,
): { codes: string[]; eccDisabled: boolean } {
  return eccField
    ? { codes: [lbssField, eccField], eccDisabled: false }
    : { codes: [lbssField], eccDisabled: true };
}

const REANALYSIS_NOTE =
  "Updating the table does NOT auto-recompute past activities. To apply it to " +
  "history, bulk-Analyze the target period in the Intervals.icu UI with " +
  '"Keep existing intervals" enabled (rapid re-runs hit a 429 rate limit). ' +
  "Because the script keys CI off gear_id, re-analysis is idempotent.";

export const updateLbssCiTableTool: ToolDef = {
  name: "update_lbss_ci_table",
  title: "Update LBSS CI Table",
  writesAccount: true,
  description:
    "Update the per-shoe Critical Impact (CI) table inside the LBSS custom-field scripts. " +
    "WRITES to your account; the highest-risk write here, so it is dry-run by default — pass apply:true to write. " +
    "It updates the LBSS field AND the Ecc field together (CI must stay identical across both; " +
    "a one-field update would silently corrupt analysis); set ECC_FIELD=\"\" to update LBSS only. " +
    "It rewrites ONLY the managed `let CI_TABLE = {...};` line between the sentinel markers — if a " +
    "field script has not adopted that contract, nothing is written. " +
    "Value policy: CI drifts over a shoe's life (a real shoe drifted -10 across its lifetime), so prefer a " +
    "recent-window estimate refreshed monthly over a lifetime pool. Build values with " +
    "estimate_critical_impact(gear_id=…) first, then pass them here as ci_table.entries (gear_id → CI).",
  schema: {
    ci_table: z
      .object({
        default: z
          .number()
          .min(20)
          .max(120)
          .describe("Fallback CI for activities with no per-gear entry (20–120)."),
        entries: z
          .record(
            z.string().regex(/^\d+$/, "gear_id must be a numeric string"),
            z.number().min(20).max(120),
          )
          .optional()
          .describe("Optional gear_id → CI map (each value 20–120). Get gear_ids from list_gear."),
      })
      .describe("The CI table to write: a required default plus optional per-gear entries."),
    apply: z
      .boolean()
      .optional()
      .describe("false/omitted = dry-run (preview only). Pass true to actually write both fields."),
  },
  handler: async (
    { ci_table, apply }: { ci_table: CiTableInput; apply?: boolean },
    ctx?: ToolContext,
  ) => {
    const { codes: targetCodes, eccDisabled } = resolveTargetCodes(
      config_.lbssField,
      config_.eccField, // "" disables the Ecc field
    );

    const items = (await intervalsClient.getCustomItems({ signal: ctx?.signal })) as CustomItem[];

    // Resolve each target field by content.code (fallback: display name).
    const resolved = targetCodes.map((code) => {
      const item =
        items.find((i) => i.content?.code === code) ?? items.find((i) => i.name === code);
      if (!item) {
        throw new Error(
          `Custom field not found for code "${code}". Check LBSS_FIELD / ECC_FIELD against your ` +
            "Intervals.icu custom fields (match is by field Code).",
        );
      }
      return { code, item };
    });

    // Validate the sentinel contract + prepare the new content for EVERY field
    // BEFORE writing anything. If any field's script lacks the contract, this
    // throws and nothing is written — no partial update, no CI divergence.
    const prepared = resolved.map(({ code, item }) => {
      const script = item.content?.script ?? "";
      try {
        return { code, item, ...prepareCiTableUpdate(script, ci_table) };
      } catch (e) {
        throw new Error(`[${code}] ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    const proposedTable: Record<string, number> = {
      default: ci_table.default,
      ...(ci_table.entries ?? {}),
    };

    // Zod .default() is unreliable over MCP transport (CLAUDE.md) → explicit check.
    if (apply !== true) {
      return {
        applied: false,
        ecc_disabled: eccDisabled,
        target_fields: targetCodes,
        fields: prepared.map((p) => ({
          field: p.code,
          field_id: p.item.id,
          current_table: p.currentTable,
          proposed_table: proposedTable,
          line_before: p.currentLine,
          line_after: p.newLine,
        })),
        reanalysis_note: REANALYSIS_NOTE,
      };
    }

    // apply: all markers already validated above. Write each, then read back and
    // verify the persisted script matches what we sent.
    for (const p of prepared) {
      const newItem = { ...p.item, content: { ...(p.item.content ?? {}), script: p.newContent } };
      await intervalsClient.updateCustomItem(p.item.id, newItem, { signal: ctx?.signal });
    }

    const after = (await intervalsClient.getCustomItems({ signal: ctx?.signal })) as CustomItem[];

    return {
      applied: true,
      ecc_disabled: eccDisabled,
      target_fields: targetCodes,
      fields: prepared.map((p) => {
        const reread = after.find((i) => String(i.id) === String(p.item.id));
        return {
          field: p.code,
          field_id: p.item.id,
          current_table: p.currentTable,
          proposed_table: proposedTable,
          line_after: p.newLine,
          backup_content: p.item.content?.script ?? "",
          verified: reread?.content?.script === p.newContent,
        };
      }),
      reanalysis_note: REANALYSIS_NOTE,
    };
  },
};
