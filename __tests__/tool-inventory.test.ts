// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const indexTs = readFileSync(join(repoRoot, "src/index.ts"), "utf-8");
const instructionsTs = readFileSync(join(repoRoot, "src/instructions.ts"), "utf-8");

const EXPECTED_TOOLS: Array<{ name: string; registerFn: string }> = [
  // Core
  { name: "get_activities", registerFn: "registerGetActivities" },
  { name: "get_activity_detail", registerFn: "registerGetActivityDetail" },
  { name: "get_activity_streams_summary", registerFn: "registerGetStreamsSummary" },
  { name: "search_similar_activities", registerFn: "registerSearchSimilarActivities" },
  { name: "get_wellness", registerFn: "registerGetWellness" },
  { name: "get_athlete_summary", registerFn: "registerGetAthleteSummary" },
  { name: "get_events", registerFn: "registerGetEvents" },
  { name: "create_events", registerFn: "registerCreateEvents" },
  { name: "update_event", registerFn: "registerUpdateEvent" },
  { name: "delete_event", registerFn: "registerDeleteEvent" },
  { name: "delete_events", registerFn: "registerDeleteEvents" },
  { name: "get_hrv_trends", registerFn: "registerGetHrvTrends" },
  { name: "clear_cache", registerFn: "registerClearCache" },
  { name: "set_cache_enabled", registerFn: "registerSetCacheEnabled" },
  // Stryd extensions
  { name: "get_current_pmc", registerFn: "registerGetCurrentPmc" },
  { name: "get_weekly_summary", registerFn: "registerGetWeeklySummary" },
  { name: "get_phase_summary", registerFn: "registerGetPhaseSummary" },
];

describe("tool inventory", () => {
  it("all expected tools have a register call in src/index.ts", () => {
    for (const tool of EXPECTED_TOOLS) {
      expect(
        indexTs,
        `${tool.name}: expected ${tool.registerFn}(server) in src/index.ts`,
      ).toContain(`${tool.registerFn}(server)`);
    }
  });

  it("no extra register calls in src/index.ts", () => {
    const matches = [...indexTs.matchAll(/register([A-Z]\w+)\(server\)/g)];
    const actual = new Set(matches.map((m) => `register${m[1]}`));
    const expected = new Set(EXPECTED_TOOLS.map((t) => t.registerFn));
    const extras = [...actual].filter((fn) => !expected.has(fn));
    const missing = [...expected].filter((fn) => !actual.has(fn));
    expect(
      extras,
      `unexpected register calls in src/index.ts: ${extras.join(", ")}`,
    ).toEqual([]);
    expect(
      missing,
      `register calls missing from src/index.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("all expected tools listed in src/instructions.ts Recommended workflow", () => {
    const match = instructionsTs.match(/## Recommended workflow\n([\s\S]*?)(?=\n## )/);
    expect(match, "Recommended workflow section not found in src/instructions.ts").not.toBeNull();
    const section = match![1];
    for (const tool of EXPECTED_TOOLS) {
      const re = new RegExp(`^\\s*\\d+\\.\\s+${tool.name}\\b`, "m");
      expect(
        re.test(section),
        `${tool.name}: expected numbered entry in Recommended workflow section`,
      ).toBe(true);
    }
  });

  it("all expected tools also appear in Tool selection guide section", () => {
    const match = instructionsTs.match(/## Tool selection guide\n([\s\S]*?)(?=\n## )/);
    expect(match, "Tool selection guide section not found in src/instructions.ts").not.toBeNull();
    const section = match![1];
    for (const tool of EXPECTED_TOOLS) {
      expect(
        section.includes(tool.name),
        `${tool.name}: expected to appear in Tool selection guide section`,
      ).toBe(true);
    }
  });
});
