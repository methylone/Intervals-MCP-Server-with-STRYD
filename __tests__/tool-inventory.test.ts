// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOLS } from "../src/tool-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const instructionsTs = readFileSync(join(repoRoot, "src/instructions.ts"), "utf-8");

/** Tool names registered in the transport-free ToolDef registry. */
const registryNames = new Set(TOOLS.map((t) => t.name));

const EXPECTED_TOOLS: string[] = [
  // Core
  "get_activities",
  "get_activity_detail",
  "get_activity_streams_summary",
  "search_similar_activities",
  "get_wellness",
  "get_athlete_summary",
  "get_events",
  "create_events",
  "update_event",
  "delete_event",
  "delete_events",
  "get_hrv_trends",
  "clear_cache",
  "set_cache_enabled",
  // Stryd extensions
  "get_current_pmc",
  "get_weekly_summary",
  "get_phase_summary",
];

describe("tool inventory (pure registry)", () => {
  it("TOOLS registry contains exactly the 17 expected tools", () => {
    expect(registryNames).toEqual(new Set(EXPECTED_TOOLS));
    expect(TOOLS).toHaveLength(EXPECTED_TOOLS.length);
  });

  it("all expected tools listed in src/instructions.ts Recommended workflow", () => {
    const match = instructionsTs.match(/## Recommended workflow\n([\s\S]*?)(?=\n## )/);
    expect(match, "Recommended workflow section not found in src/instructions.ts").not.toBeNull();
    const section = match![1];
    for (const tool of EXPECTED_TOOLS) {
      const re = new RegExp(`^\\s*\\d+\\.\\s+${tool}\\b`, "m");
      expect(
        re.test(section),
        `${tool}: expected numbered entry in Recommended workflow section`,
      ).toBe(true);
    }
  });

  it("all expected tools also appear in Tool selection guide section", () => {
    const match = instructionsTs.match(/## Tool selection guide\n([\s\S]*?)(?=\n## )/);
    expect(match, "Tool selection guide section not found in src/instructions.ts").not.toBeNull();
    const section = match![1];
    for (const tool of EXPECTED_TOOLS) {
      expect(
        section.includes(tool),
        `${tool}: expected to appear in Tool selection guide section`,
      ).toBe(true);
    }
  });
});
