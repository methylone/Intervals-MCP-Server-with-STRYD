// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.10.0 §4: estimate_critical_impact emits coverage WARNINGS (not gates) for
// thin flat-second weight / few activities — the quality gates can pass on thin
// data. Drives the real handler with stubbed fetch (cache disabled).
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { estimateCriticalImpactTool } from "../src/extensions/stryd/tools/estimate-critical-impact.js";
import { setCacheEnabled } from "../src/core/cache.js";

beforeEach(() => setCacheEnabled(false));
afterEach(() => {
  setCacheEnabled(true);
  vi.unstubAllGlobals();
});

// One treadmill (VirtualRun → graded flat) activity with 8 power bins ×6 samples
// in the [0.5,1.05]·CP band: enough for a fit, but tiny weight (48) and 1 activity.
function syntheticStreams() {
  const watts: number[] = [];
  const ilr: number[] = [];
  for (let w = 100; w <= 170; w += 10) {
    for (let k = 0; k < 6; k++) {
      watts.push(w);
      ilr.push(w * 0.25);
    }
  }
  const time = watts.map((_, i) => i);
  return [
    { type: "time", data: time },
    { type: "watts", data: watts },
    { type: "StrydILR", data: ilr },
  ];
}

function stubFetch() {
  const activity = {
    id: "i1",
    type: "VirtualRun",
    start_date_local: "2026-06-07T06:00:00",
    gear: { id: "60751" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) => {
      const u = String(url);
      const body = u.includes("/streams") ? syntheticStreams() : [activity];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

describe("estimate_critical_impact coverage warnings", () => {
  it("warns on thin flat-second weight and few activities while keeping a regression", async () => {
    stubFetch();
    const out = (await estimateCriticalImpactTool.handler({
      cp_watts: 200,
      as_of: "2026-06-07",
    })) as {
      regression: { n_points_weight: number } | null;
      coverage: { n_activities_used: number };
      quality: { warnings: string[] };
    };

    expect(out.regression).not.toBeNull(); // bins/range gates pass → fit present
    expect(out.coverage.n_activities_used).toBe(1);
    const w = out.quality.warnings.join(" | ");
    expect(w).toMatch(/thin data: only \d+s of flat seconds/);
    expect(w).toMatch(/few activities \(1\)/);
  });
});
