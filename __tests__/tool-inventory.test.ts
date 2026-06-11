// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOLS, getActiveTools } from "../src/tool-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const instructionsTs = readFileSync(join(repoRoot, "src/instructions.ts"), "utf-8");

const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf-8")) as {
  tools: { name: string }[];
};

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
  "list_gear",
  "assign_gear",
  "create_gear",
  "retire_gear",
  "clear_cache",
  "set_cache_enabled",
  // Stryd extensions
  "get_current_pmc",
  "get_weekly_summary",
  "get_phase_summary",
  "estimate_critical_impact",
  "update_lbss_ci_table",
];

const WRITE_TOOLS = [
  "create_events",
  "update_event",
  "delete_event",
  "delete_events",
  "assign_gear",
  "create_gear",
  "retire_gear",
  "update_lbss_ci_table",
];

describe("tool inventory (pure registry)", () => {
  it("TOOLS registry contains exactly the 23 expected tools", () => {
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

  it("manifest.json tools[] match the registry exactly (full 23, not READ_ONLY-filtered)", () => {
    // The manifest's tools list is descriptive (tools_generated: false) — guard it
    // against drift the way EXPECTED_TOOLS guards the registry. Compare to TOOLS
    // directly: READ_ONLY filtering is a runtime concern, the manifest advertises
    // the full surface. (estimate_critical_impact was missed here in v0.7.0; this
    // test would have caught it.)
    const manifestNames = new Set(manifest.tools.map((t) => t.name));
    expect(manifestNames).toEqual(registryNames);
    expect(manifest.tools).toHaveLength(TOOLS.length);
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

describe("READ_ONLY mode (getActiveTools)", () => {
  afterEach(() => {
    delete process.env.READ_ONLY;
  });

  it("default mode exposes all 23 tools", () => {
    delete process.env.READ_ONLY;
    expect(getActiveTools().map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(getActiveTools()).toHaveLength(23);
  });

  it("READ_ONLY=true withholds exactly the 8 account-writing tools (15 remain)", () => {
    process.env.READ_ONLY = "true";
    const names = getActiveTools().map((t) => t.name);
    expect(getActiveTools()).toHaveLength(15);
    for (const w of WRITE_TOOLS) {
      expect(names, `${w} should be withheld in READ_ONLY`).not.toContain(w);
    }
    // Local-only side-effect tools remain available.
    expect(names).toContain("clear_cache");
    expect(names).toContain("set_cache_enabled");
  });

  it("the withheld set equals the tools flagged writesAccount", () => {
    const flagged = TOOLS.filter((t) => t.writesAccount).map((t) => t.name).sort();
    expect(flagged).toEqual([...WRITE_TOOLS].sort());
  });
});
