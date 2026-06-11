// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  buildFlatBins,
  wols,
  estimateCi,
  type StreamMap,
  type FlatBin,
} from "../src/extensions/stryd/ci-estimator.js";

/** Build a canonical StreamMap from plain arrays. */
function mk(streams: Partial<Record<"watts" | "ilr" | "altitude" | "distance", (number | null)[]>>): StreamMap {
  const m: StreamMap = new Map();
  for (const [k, v] of Object.entries(streams)) {
    if (v) m.set(k, v);
  }
  return m;
}

describe("wols", () => {
  it("fits a known weighted line y = 2 + 3x", () => {
    // Perfectly linear points; weights should not change the fit.
    const pts: Array<[number, number, number]> = [
      [0, 2, 1],
      [10, 32, 5],
      [20, 62, 3],
      [30, 92, 2],
    ];
    const f = wols(pts);
    expect(f).not.toBeNull();
    expect(f!.a).toBeCloseTo(2, 6);
    expect(f!.b).toBeCloseTo(3, 6);
  });

  it("returns null when all x are equal (sxx = 0)", () => {
    expect(wols([[100, 5, 3], [100, 7, 4], [100, 6, 2]])).toBeNull();
  });

  it("returns null when total weight is 0", () => {
    expect(wols([[1, 1, 0], [2, 2, 0]])).toBeNull();
  });
});

describe("buildFlatBins", () => {
  // 60 flat seconds at a steady 200 W, ILR 50, gentle even climb (grade ≈ 0).
  function flatRun(opts: { watts?: number; ilr?: number; n?: number } = {}): {
    watts: number[];
    ilr: number[];
    altitude: number[];
    distance: number[];
  } {
    const n = opts.n ?? 60;
    const watts = new Array(n).fill(opts.watts ?? 200);
    const ilr = new Array(n).fill(opts.ilr ?? 50);
    const altitude = new Array(n).fill(100); // perfectly flat
    const distance = Array.from({ length: n }, (_, i) => i * 3); // 3 m/s → >5 m per window
    return { watts, ilr, altitude, distance };
  }

  it("bins steady flat running into one 10 W bin (n ≥ 5)", () => {
    const bins = buildFlatBins(mk(flatRun()), false);
    expect(bins).not.toBeNull();
    expect(bins!.length).toBe(1);
    expect(bins![0].wattsMean).toBeCloseTo(200, 6);
    expect(bins![0].ilrMean).toBeCloseTo(50, 6);
    // Edge seconds inside ±10-sample windows are dropped → fewer than n.
    expect(bins![0].n).toBeGreaterThanOrEqual(5);
  });

  it("returns null when altitude is missing on an outdoor run", () => {
    const r = flatRun();
    expect(buildFlatBins(mk({ watts: r.watts, ilr: r.ilr, distance: r.distance }), false)).toBeNull();
  });

  it("treadmill (VirtualRun) needs no altitude and grades as flat", () => {
    const r = flatRun();
    const bins = buildFlatBins(mk({ watts: r.watts, ilr: r.ilr, distance: r.distance }), true);
    expect(bins).not.toBeNull();
    expect(bins!.length).toBe(1);
  });

  it("returns null when there is no ILR stream", () => {
    const r = flatRun();
    expect(buildFlatBins(mk({ watts: r.watts, altitude: r.altitude, distance: r.distance }), false)).toBeNull();
  });

  it("excludes steep seconds beyond the ±1.5% grade boundary", () => {
    const n = 60;
    const watts = new Array(n).fill(200);
    const ilr = new Array(n).fill(50);
    const distance = Array.from({ length: n }, (_, i) => i * 3); // 3 m over 1 s
    // Climb 0.2 m/s → over a ±10s (60 m) window, rise ≈ 4 m → grade ≈ 6.7% (>1.5).
    const altitude = Array.from({ length: n }, (_, i) => 100 + i * 0.2);
    const bins = buildFlatBins(mk({ watts, ilr, altitude, distance }), false);
    // All qualifying seconds are too steep → no surviving bins.
    expect(bins).toEqual([]);
  });

  it("invalidates seconds where window distance delta < 5 m (near-stationary)", () => {
    const n = 60;
    const watts = new Array(n).fill(200);
    const ilr = new Array(n).fill(50);
    const altitude = new Array(n).fill(100);
    const distance = Array.from({ length: n }, (_, i) => i * 0.1); // 0.1 m/s → 2 m per 20s window
    const bins = buildFlatBins(mk({ watts, ilr, altitude, distance }), false);
    expect(bins).toEqual([]); // every second fails the distance-delta guard
  });

  it("drops sparse bins with fewer than 5 samples", () => {
    // 4 seconds of qualifying data only → bin n=... below threshold once windows trim.
    const n = 12;
    const watts = new Array(n).fill(200);
    const ilr = new Array(n).fill(50);
    const altitude = new Array(n).fill(100);
    const distance = Array.from({ length: n }, (_, i) => i * 3);
    const bins = buildFlatBins(mk({ watts, ilr, altitude, distance }), false);
    // Only indices 10..(n-11) survive the ±10 window → far fewer than 5 → dropped.
    expect(bins).toEqual([]);
  });

  it("skips null and non-positive watts/ILR seconds", () => {
    const n = 80;
    const watts: (number | null)[] = new Array(n).fill(200);
    const ilr: (number | null)[] = new Array(n).fill(50);
    watts[15] = null;
    watts[16] = 0;
    ilr[17] = -1;
    const altitude = new Array(n).fill(100);
    const distance = Array.from({ length: n }, (_, i) => i * 3);
    const bins = buildFlatBins(mk({ watts, ilr, altitude, distance }), false);
    expect(bins).not.toBeNull();
    expect(bins![0].wattsMean).toBeCloseTo(200, 6);
  });
});

describe("estimateCi gates", () => {
  // A clean linear cloud across a wide band so fits succeed when gates allow.
  function spreadBins(count: number, fromW: number, stepW: number): FlatBin[] {
    return Array.from({ length: count }, (_, i) => {
      const w = fromW + i * stepW;
      return { wattsMean: w, ilrMean: 0.2 * w + 10, n: 20 };
    });
  }

  const cp = 200;
  const opts = { loFrac: 0.5, hiFrac: 1.05, historyDays: 90 };

  it("estimates CI when all gates pass", () => {
    // 9 bins spanning 100..180 W (range 80 ≥ 40), all within [100, 210].
    const r = estimateCi([spreadBins(9, 100, 10)], cp, opts);
    expect(r.quality.ok).toBe(true);
    expect(r.ciEstimate).not.toBeNull();
    // ILR = 0.2·CP + 10 = 50 at CP=200.
    expect(r.ciEstimate).toBeCloseTo(50, 1);
  });

  it("bins gate: 7 bins fails, 8 passes", () => {
    expect(estimateCi([spreadBins(7, 100, 10)], cp, opts).quality.binsOk).toBe(false);
    expect(estimateCi([spreadBins(8, 100, 10)], cp, opts).quality.binsOk).toBe(true);
  });

  it("power-range gate: 39 W fails, 40 W passes", () => {
    // 8 bins, spacing chosen so max-min = 39 vs 40.
    const r39 = estimateCi([
      Array.from({ length: 8 }, (_, i) => ({ wattsMean: 120 + i * (39 / 7), ilrMean: 40, n: 20 })),
    ], cp, opts);
    const r40 = estimateCi([
      Array.from({ length: 8 }, (_, i) => ({ wattsMean: 120 + i * (40 / 7), ilrMean: 40 + i, n: 20 })),
    ], cp, opts);
    expect(r39.quality.powerRangeOk).toBe(false);
    expect(r40.quality.powerRangeOk).toBe(true);
  });

  it("history gate: 59 days fails, 60 days passes (ci withheld but regression kept)", () => {
    const bins = [spreadBins(9, 100, 10)];
    const r59 = estimateCi(bins, cp, { ...opts, historyDays: 59 });
    const r60 = estimateCi(bins, cp, { ...opts, historyDays: 60 });
    expect(r59.quality.historyOk).toBe(false);
    expect(r59.ciEstimate).toBeNull();
    expect(r59.regression).not.toBeNull(); // fit still exposed for transparency
    expect(r60.quality.historyOk).toBe(true);
    expect(r60.ciEstimate).not.toBeNull();
  });

  it("filters bins outside the [lo·CP, hi·CP] band", () => {
    // Bins far below/above the band should be excluded from the fit.
    const inBand = spreadBins(9, 110, 10); // 110..190 within [100, 210]
    const outLow = [{ wattsMean: 40, ilrMean: 99, n: 50 }]; // below 0.5·CP=100
    const r = estimateCi([inBand, outLow], cp, opts);
    // The out-of-band point (which would distort the line) must not be counted.
    expect(r.regression!.nBins).toBe(9);
  });
});
