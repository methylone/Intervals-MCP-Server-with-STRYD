// SPDX-License-Identifier: AGPL-3.0-or-later
// FR (v0.9.0): get_activity_streams_summary surfaces per-split + overall
// avg_ilr / ilr_p95 and data_quality.has_ilr. Drives the real handler with a
// stubbed fetch (cache disabled so no disk read/write) and synthetic streams.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getStreamsSummaryTool } from "../src/core/tools/get-streams-summary.js";
import { setCacheEnabled } from "../src/core/cache.js";

// Test env leaves ILR_FIELD unset → config default "StrydILR".
const ILR_TYPE = "StrydILR";

type Stream = { type: string; data: (number | null)[] };

function stubStreams(streams: Stream[], detail: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) => {
      const u = String(url);
      const body = u.includes("/streams") ? streams : detail;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

beforeEach(() => setCacheEnabled(false));
afterEach(() => {
  setCacheEnabled(true);
  vi.unstubAllGlobals();
});

// 10 steadily-moving seconds; ILR ramps 1..10 so percentiles are predictable.
function baseStreams(ilr: (number | null)[] | null): Stream[] {
  const n = 10;
  const s: Stream[] = [
    { type: "time", data: Array.from({ length: n }, (_, i) => i) },
    { type: "velocity_smooth", data: new Array(n).fill(3) },
    { type: "distance", data: Array.from({ length: n }, (_, i) => i * 3) },
    { type: "fixed_heartrate", data: new Array(n).fill(150) },
  ];
  if (ilr) s.push({ type: ILR_TYPE, data: ilr });
  return s;
}

const callArgs = {
  activity_id: "i999",
  split_method: "halves" as const,
  warmup_exclude_sec: 0,
  post_stop_buffer_sec: 30,
};

describe("streams summary — split ILR FR", () => {
  it("with ILR present: overall avg_ilr / ilr_p95 + has_ilr, per-split values", async () => {
    stubStreams(baseStreams([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { name: "Test", has_weather: false });

    const out = (await getStreamsSummaryTool.handler(callArgs)) as {
      overall: { avg_ilr: number | null; ilr_p95: number | null };
      splits: Array<{ avg_ilr: number | null; ilr_p95: number | null }>;
      data_quality: { has_ilr: boolean };
    };

    expect(out.data_quality.has_ilr).toBe(true);
    // mean(1..10)=5.5; nearest-rank p95 of 10 values → 10th = 10
    expect(out.overall.avg_ilr).toBe(5.5);
    expect(out.overall.ilr_p95).toBe(10);
    // every split carries numeric avg_ilr / ilr_p95
    expect(out.splits.length).toBeGreaterThanOrEqual(2);
    for (const sp of out.splits) {
      expect(typeof sp.avg_ilr).toBe("number");
      expect(typeof sp.ilr_p95).toBe("number");
    }
  });

  it("without ILR stream: has_ilr false and avg_ilr / ilr_p95 null", async () => {
    stubStreams(baseStreams(null), { name: "Test", has_weather: false });

    const out = (await getStreamsSummaryTool.handler(callArgs)) as {
      overall: { avg_ilr: number | null; ilr_p95: number | null };
      splits: Array<{ avg_ilr: number | null; ilr_p95: number | null }>;
      data_quality: { has_ilr: boolean };
    };

    expect(out.data_quality.has_ilr).toBe(false);
    expect(out.overall.avg_ilr).toBeNull();
    expect(out.overall.ilr_p95).toBeNull();
    for (const sp of out.splits) {
      expect(sp.avg_ilr).toBeNull();
      expect(sp.ilr_p95).toBeNull();
    }
  });
});
