// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CLI transport adapter for ToolDef (Stage 2 Phase 0).
 *
 * Applies defaults/validation via `z.object(schema).parseAsync` (so omitted
 * defaults work natively, unlike the MCP transport), runs the raw-data
 * handler, and returns a JSON string. Printing and process exit stay in
 * cli.ts — this adapter only produces the string.
 *
 * Transport-free: imports only zod, never express or src/index.ts.
 *
 * Phase 0 proves `runToolDef` via unit tests; the live cli.ts dispatch
 * switch to TOOLS is deferred to the Phase 1 cutover (when all 17 tools are
 * in TOOLS), so no unmigrated tool disappears from the CLI in the meantime.
 */
import { z } from "zod";
import type { ToolDef } from "../tool-registry.js";

export async function runToolDef(
  t: ToolDef,
  rawArgs: unknown,
  opts: { raw: boolean },
): Promise<string> {
  const args = await z.object(t.schema).parseAsync(rawArgs);
  const data = await t.handler(args);
  return JSON.stringify(data, null, opts.raw ? undefined : 2);
}
