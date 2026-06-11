// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CI (Critical Impact) reverse-estimation — pure computation layer.
 *
 * Reproduces Stryd's per-shoe `critical_impact` from Intervals.icu streams
 * (watts / ILR / altitude / distance) and the athlete's Critical Power, with no
 * Stryd API. Validated against 102 labelled activities (warmup ≥60d): r=0.93,
 * RMSE=1.9 bw/s, bias −1.3. Spec: opus v0.7.0 relay; pilot
 * ci_reverse_pilot_20260607.md.
 *
 * Algorithm:
 *   CI_est = a + b·CP, where (a,b) = weighted-OLS(ILR_bin_mean ~ watts_bin_mean,
 *   weight = bin sample count). Per activity, flat seconds (|grade| ≤ 1.5%,
 *   watts>0, ILR>0) are binned by 10 W; bins with n<5 are dropped. The estimator
 *   pools bins across the window, keeps those whose mean power is within
 *   [lo·CP, hi·CP], and gates on bin count / power spread / history length.
 *
 * No I/O, no config: the tool layer resolves the ILR field name and builds the
 * StreamMap with canonical keys ("watts" / "ilr" / "altitude" / "distance").
 */

/** Map of canonical stream key → per-second samples. Keys: watts, ilr, altitude, distance. */
export type StreamMap = Map<string, (number | null)[]>;

/** One 10 W power bin: mean watts, mean ILR, and the sample count (the OLS weight). */
export type FlatBin = { wattsMean: number; ilrMean: number; n: number };

// ── Algorithm constants (validated; not configurable per spec §2.2) ──────────
/** Max |grade| (%) for a second to count as flat. */
export const FLAT_GRADE_PCT = 1.5;
/** Half-width (samples) of the centered window used to compute grade. */
export const GRADE_WINDOW = 10;
/** Minimum distance delta (m) across the grade window; below this, grade diverges. */
export const MIN_GRADE_DISTANCE_M = 5;
/** Power bin width (W). */
export const BIN_WIDTH_W = 10;
/** Drop bins with fewer than this many samples (noise). */
export const MIN_BIN_SAMPLES = 5;

// ── Quality-gate thresholds ──────────────────────────────────────────────────
export const MIN_BINS = 8;
export const MIN_POWER_RANGE_W = 40;
export const MIN_HISTORY_DAYS = 60;

/** Weighted OLS y = a + b·x over (x, y, weight) points. null on degenerate input. */
export function wols(points: Array<[number, number, number]>): { a: number; b: number } | null {
  let w = 0;
  for (const p of points) w += p[2];
  if (w <= 0) return null;
  let mx = 0;
  let my = 0;
  for (const [x, y, wt] of points) {
    mx += x * wt;
    my += y * wt;
  }
  mx /= w;
  my /= w;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y, wt] of points) {
    sxx += wt * (x - mx) * (x - mx);
    sxy += wt * (x - mx) * (y - my);
  }
  if (sxx <= 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/**
 * Build 10 W watts→ILR bins from one activity's flat seconds.
 *
 * Returns null when the activity cannot be assessed for flatness — no ILR stream,
 * or an outdoor run with no altitude stream (grade is undeterminable). Returns an
 * empty array when assessable but no qualifying flat bins survive. Treadmill runs
 * (isVirtualRun) are graded as flat throughout (Stryd ignores TM incline too).
 */
export function buildFlatBins(streams: StreamMap, isVirtualRun: boolean): FlatBin[] | null {
  const watts = streams.get("watts");
  const ilr = streams.get("ilr");
  if (!watts || !ilr || watts.length === 0) return null; // ILR required to assess at all
  if (!ilr.some((v) => v !== null)) return null;

  const n = watts.length;
  const altitude = streams.get("altitude");
  const distance = streams.get("distance");

  if (!isVirtualRun) {
    // Outdoor: need both altitude and distance to judge grade.
    if (!altitude || !altitude.some((v) => v !== null)) return null;
    if (!distance || !distance.some((v) => v !== null)) return null;
  }

  // Accumulate sums per 10 W bin key.
  const sums = new Map<number, { sumW: number; sumI: number; n: number }>();

  for (let i = 0; i < n; i++) {
    const w = watts[i];
    const il = ilr[i];
    if (w === null || il === null || w <= 0 || il <= 0) continue;

    // Grade: 0 for treadmill; else centered window altitude-delta / distance-delta.
    let gradePct: number;
    if (isVirtualRun) {
      gradePct = 0;
    } else {
      const lo = i - GRADE_WINDOW;
      const hi = i + GRADE_WINDOW;
      if (lo < 0 || hi >= n) continue; // window out of range → can't judge this second
      const aLo = altitude![lo];
      const aHi = altitude![hi];
      const dLo = distance![lo];
      const dHi = distance![hi];
      if (aLo === null || aHi === null || dLo === null || dHi === null) continue;
      const dDist = dHi - dLo;
      if (dDist < MIN_GRADE_DISTANCE_M) continue; // stopped/creeping → grade diverges
      gradePct = ((aHi - aLo) / dDist) * 100;
    }

    if (Math.abs(gradePct) > FLAT_GRADE_PCT) continue;

    const key = Math.floor(w / BIN_WIDTH_W);
    const bin = sums.get(key);
    if (bin) {
      bin.sumW += w;
      bin.sumI += il;
      bin.n += 1;
    } else {
      sums.set(key, { sumW: w, sumI: il, n: 1 });
    }
  }

  const bins: FlatBin[] = [];
  for (const { sumW, sumI, n: count } of sums.values()) {
    if (count < MIN_BIN_SAMPLES) continue;
    bins.push({ wattsMean: sumW / count, ilrMean: sumI / count, n: count });
  }
  return bins;
}

export interface EstimateCiOptions {
  /** Lower band fraction of CP (validated constant; supplied so tests can sweep). */
  loFrac: number;
  /** Upper band fraction of CP. */
  hiFrac: number;
  /** Days from the oldest pooled activity to as_of (for the history gate). */
  historyDays: number;
}

export interface CiEstimate {
  /** a + b·CP, rounded to 1 dp, when ALL gates pass; null otherwise. */
  ciEstimate: number | null;
  /** OLS fit + shape stats, present whenever a fit could be computed (bins/range OK). */
  regression: {
    interceptA: number;
    slopeB: number;
    nBins: number;
    nPointsWeight: number;
    powerRangeW: number;
  } | null;
  quality: {
    ok: boolean;
    binsOk: boolean;
    powerRangeOk: boolean;
    historyOk: boolean;
  };
}

/**
 * Pool the per-activity bins, restrict to the [lo·CP, hi·CP] band, and fit
 * weighted-OLS to estimate CI = a + b·CP. The caller is responsible for window
 * filtering (only pass bins from activities within the lookback) and for
 * computing historyDays. Quality gates: ≥8 band bins, ≥40 W spread, ≥60 d
 * history. `regression` is returned whenever the shape gates pass and the fit is
 * non-degenerate, even if the history gate fails — so callers/tests can read the
 * raw fit. `ciEstimate` is non-null only when every gate passes.
 */
export function estimateCi(
  binsByActivity: FlatBin[][],
  cpWatts: number,
  opts: EstimateCiOptions,
): CiEstimate {
  const loW = opts.loFrac * cpWatts;
  const hiW = opts.hiFrac * cpWatts;

  const points: Array<[number, number, number]> = [];
  let minW = Infinity;
  let maxW = -Infinity;
  let weightSum = 0;
  for (const bins of binsByActivity) {
    for (const b of bins) {
      if (b.wattsMean < loW || b.wattsMean > hiW) continue;
      points.push([b.wattsMean, b.ilrMean, b.n]);
      if (b.wattsMean < minW) minW = b.wattsMean;
      if (b.wattsMean > maxW) maxW = b.wattsMean;
      weightSum += b.n;
    }
  }

  const nBins = points.length;
  const powerRangeW = nBins > 0 ? maxW - minW : 0;
  const binsOk = nBins >= MIN_BINS;
  const powerRangeOk = powerRangeW >= MIN_POWER_RANGE_W;
  const historyOk = opts.historyDays >= MIN_HISTORY_DAYS;

  // A meaningful fit needs the data-shape gates; history gate only withholds the
  // final number, not the fit (transparency).
  const fit = binsOk && powerRangeOk ? wols(points) : null;

  const regression = fit
    ? {
        interceptA: fit.a,
        slopeB: fit.b,
        nBins,
        nPointsWeight: weightSum,
        powerRangeW,
      }
    : null;

  const ok = binsOk && powerRangeOk && historyOk && fit !== null;
  const ciEstimate = ok && fit ? Math.round((fit.a + fit.b * cpWatts) * 10) / 10 : null;

  return {
    ciEstimate,
    regression,
    quality: { ok, binsOk, powerRangeOk, historyOk },
  };
}
