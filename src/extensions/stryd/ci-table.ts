// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CI_TABLE sentinel contract — pure text layer for update_lbss_ci_table (v0.10.0).
 *
 * The highest-risk write in the project rewrites a per-shoe Critical Impact table
 * embedded in an Intervals.icu custom-field script. To make a syntax error
 * structurally impossible, the tool NEVER writes arbitrary script text: it
 * replaces exactly the single managed line
 *
 *     let CI_TABLE = {"default":57.4,"60751":58};
 *
 * between two sentinel comments:
 *
 *     // === CI_TABLE_BEGIN (managed by intervals-mcp; do not edit this line by hand) ===
 *     let CI_TABLE = {...};
 *     // === CI_TABLE_END ===
 *
 * Everything outside the managed line is preserved byte-for-byte. If the markers
 * are missing, duplicated, or do not wrap exactly one line, NOTHING is written —
 * the field script has not adopted the contract yet.
 *
 * No I/O, no config — the tool layer resolves field names/ids and does the GET/PUT.
 */

export const MANAGED_BEGIN_TOKEN = "CI_TABLE_BEGIN";
export const MANAGED_END_TOKEN = "CI_TABLE_END";

export const CONTRACT_ERROR =
  "CI_TABLE sentinel contract not found in this field's script. Expected exactly one " +
  "`// === CI_TABLE_BEGIN ... ===` / `// === CI_TABLE_END ===` pair wrapping a single " +
  "managed `let CI_TABLE = {...};` line. Adopt the contract in the field script first " +
  "(see the nara-ultra CI-table sentinel relay), then retry.";

export interface CiTableInput {
  default: number;
  entries?: Record<string, number>;
}

/** Render a number for embedding in the table (JS Number → its JSON form). */
function numStr(n: number): string {
  return String(n);
}

/**
 * Render the managed line deterministically: `default` first, then gear_id keys in
 * ASCENDING NUMERIC order. The string is built by hand rather than via
 * JSON.stringify on an object, because JS reorders integer-like object keys ahead
 * of "default" — which would violate the spec's "default → gear_id ascending" order.
 */
export function renderCiTableLine(table: CiTableInput): string {
  const parts: string[] = [`"default":${numStr(table.default)}`];
  if (table.entries) {
    const keys = Object.keys(table.entries).sort((a, b) => Number(a) - Number(b));
    for (const k of keys) parts.push(`${JSON.stringify(k)}:${numStr(table.entries[k])}`);
  }
  return `let CI_TABLE = {${parts.join(",")}};`;
}

interface ManagedLocation {
  managedIdx: number;
  indent: string;
  /** The managed line, trimmed of surrounding whitespace. */
  currentLine: string;
}

/**
 * Locate the single managed line between the sentinels, validating the contract.
 * Throws CONTRACT_ERROR unless there is exactly one BEGIN, exactly one END (after
 * BEGIN), and exactly one line between them.
 */
function locateManaged(content: string): ManagedLocation {
  const lines = content.split("\n");
  const begins: number[] = [];
  const ends: number[] = [];
  lines.forEach((l, i) => {
    if (l.includes(MANAGED_BEGIN_TOKEN)) begins.push(i);
    if (l.includes(MANAGED_END_TOKEN)) ends.push(i);
  });
  if (begins.length !== 1 || ends.length !== 1) throw new Error(CONTRACT_ERROR);
  const beginIdx = begins[0];
  const endIdx = ends[0];
  // Exactly one line between BEGIN and END (also rejects END-before-BEGIN).
  if (endIdx - beginIdx !== 2) throw new Error(CONTRACT_ERROR);
  const managedIdx = beginIdx + 1;
  const raw = lines[managedIdx];
  const indent = /^\s*/.exec(raw)?.[0] ?? "";
  return { managedIdx, indent, currentLine: raw.trim() };
}

/**
 * Parse the current CI table from the managed line. Validates the contract and
 * that the line is `let CI_TABLE = <object of numbers>;`. Throws CONTRACT_ERROR
 * otherwise. Returns the parsed table (note: JS key order, not the rendered order).
 */
export function extractCiTable(content: string): Record<string, number> {
  const { currentLine } = locateManaged(content);
  const m = /^let\s+CI_TABLE\s*=\s*(\{.*\})\s*;$/.exec(currentLine);
  if (!m) throw new Error(CONTRACT_ERROR);
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    throw new Error(CONTRACT_ERROR);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(CONTRACT_ERROR);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "number") throw new Error(CONTRACT_ERROR);
    out[k] = v;
  }
  return out;
}

/**
 * Replace the managed line with `newManagedLine`, preserving the original
 * indentation and every other line verbatim. Validates the contract first.
 */
export function replaceManagedLine(content: string, newManagedLine: string): string {
  const { managedIdx, indent } = locateManaged(content);
  const lines = content.split("\n");
  lines[managedIdx] = indent + newManagedLine;
  return lines.join("\n");
}

/**
 * One-shot: validate the contract, read the current table, render the new line,
 * and produce the updated content. Throws CONTRACT_ERROR if the field script has
 * not adopted the sentinel contract — so the caller writes nothing.
 */
export function prepareCiTableUpdate(
  content: string,
  input: CiTableInput,
): { currentTable: Record<string, number>; currentLine: string; newLine: string; newContent: string } {
  const { currentLine } = locateManaged(content);
  const currentTable = extractCiTable(content);
  const newLine = renderCiTableLine(input);
  const newContent = replaceManagedLine(content, newLine);
  return { currentTable, currentLine, newLine, newContent };
}
