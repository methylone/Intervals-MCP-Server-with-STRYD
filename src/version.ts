// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Single source of truth for the package version.
 *
 * The MCP `serverInfo.version` used to be a hard-coded literal that drifted from
 * the real version (it read "0.1.0" while the package shipped 0.3.2, then was
 * renumbered to 0.4.0 at release). Reading package.json at runtime removes the
 * second place to update. package.json ships in both the npm tarball and the
 * .mcpb bundle, so it is always present next to the running module. Reads once;
 * never throws — falls back to a sentinel rather than crashing startup.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let cached: string | null = null;

export function getPackageVersion(): string {
  if (cached !== null) return cached;
  try {
    // build/version.js (prod) or src/version.ts (tsx/vitest) — either way the
    // package root is the parent of this module's directory.
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(moduleDir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
    cached = typeof pkg.version === "string" ? pkg.version : "0.0.0-unknown";
  } catch {
    cached = "0.0.0-unknown";
  }
  return cached;
}
