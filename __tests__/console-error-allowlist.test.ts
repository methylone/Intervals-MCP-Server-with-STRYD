// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PII guard — console.error allowlist (#14.3).
 *
 * Enumerates every `console.error(` call site under src/ and compares the
 * per-file counts to a fixed allowlist. Adding (or moving to a new file) a
 * console.error turns this test red, which forces a deliberate review:
 *
 *   - is the new log line free of credentials and upstream response bodies?
 *   - does log-sentinel.test.ts need to grow to cover the new path?
 *
 * Counting per file (not per line) keeps the test stable against incidental
 * line shifts while still catching any newly-introduced sink.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, "..", "src");
const repoRoot = join(__dirname, "..");

/** Known console.error sites, by file → count. Update only with a review. */
const ALLOWLIST: Record<string, number> = {
  "src/index.ts": 4,
  "src/cli.ts": 1,
  "src/core/cache.ts": 3,
  "src/adapters/mcp.ts": 4,
};

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function countConsoleError(source: string): number {
  return (source.match(/console\.error\(/g) ?? []).length;
}

describe("console.error allowlist (PII guard)", () => {
  it("the set of console.error sites matches the reviewed allowlist", () => {
    const found: Record<string, number> = {};
    for (const file of listTsFiles(srcRoot)) {
      const n = countConsoleError(readFileSync(file, "utf-8"));
      if (n > 0) {
        found[relative(repoRoot, file).split("\\").join("/")] = n;
      }
    }

    // Exact match: a new file with console.error, or a changed count in an
    // existing file, fails here. The remediation is to review the new sink and
    // (only then) update ALLOWLIST + log-sentinel.test.ts.
    expect(found).toEqual(ALLOWLIST);
  });

  it("the allowlist totals 12 known sites", () => {
    const total = Object.values(ALLOWLIST).reduce((a, b) => a + b, 0);
    expect(total).toBe(12);
  });
});
