// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCP tool: estimate_critical_impact
 *
 * Reverse-estimates Stryd's per-shoe Critical Impact (CI) from Intervals.icu
 * streams (watts / ILR / altitude / distance) and the athlete's Critical Power,
 * with NO Stryd API. Calibrates LBSS v2 / EccLBSS entirely inside Intervals.
 *
 * Deterministic: the LLM gets an aggregated number + quality flags, not raw
 * per-second data. Pilot-validated (warmup ≥60d, n=102): r=0.93, RMSE=1.9 bw/s,
 * residual bias −1.3 (returned raw, not auto-corrected). Spec: opus v0.7.0 relay.
 */
import { z } from "zod";
import type { ToolDef, ToolContext } from "../../../tool-registry.js";
import { config_ } from "../../../config.js";
import { intervalsClient } from "../../../core/intervals-client.js";
import type { Activity } from "../../../core/types.js";
import { streamsToMap } from "../../../utils/stream-processing.js";
import { today, parseDate, addDays } from "../../../utils/date.js";
import {
  buildFlatBins,
  estimateCi,
  type StreamMap,
  type FlatBin,
} from "../ci-estimator.js";

/**
 * Adopted power band [lo, hi]·CP. Resolved against the pilot data (§2.1): the
 * pilot doc's [0.50, 1.05] reproduces r=0.928 / RMSE=1.92 / bias −1.25 (matching
 * the published 0.93 / 1.9 / −1.3), versus [0.60, 1.10] → RMSE 2.63. NOT
 * configurable — a validated constant. See ci-estimator-regression.test.ts.
 */
const CI_BAND_LO = 0.5;
const CI_BAND_HI = 1.05;

const DEFAULT_WINDOW_DAYS = 90;
const RUN_TYPES = new Set(["Run", "VirtualRun"]);

// Coverage-warning thresholds (v0.10.0 §4). These are WARNINGS, not gates — the
// quality gates (bins/range/history) can pass on thin data (observed: Tarther RP3
// fit on 546 flat-seconds / 2 activities still gated ok), so these surface a
// "treat as indicative" caveat without nulling ci_estimate. Module constants, not
// config (like the algorithm constants in ci-estimator).
const THIN_POINTS_WEIGHT = 20000;
const FEW_ACTIVITIES = 8;
/** Concurrency for the cold-cache stream fan-out (§4.1). */
const FETCH_CONCURRENCY = 4;

/** Run `fn` over items with a bounded number in flight. Order preserved. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const ILR_TYPES_NOTE =
  "Estimate Stryd Critical Impact (CI) from Intervals.icu streams (watts, ILR, " +
  "altitude, distance) and Critical Power — no Stryd API needed. Calibrates LBSS v2. " +
  "Deterministic weighted regression over flat seconds in a lookback window. " +
  "First call on a cold cache fetches ~100–150 activity streams (slower); later calls " +
  "are fast. Taper/low-intensity periods skew the estimate low and may return ci_estimate=null " +
  "when power coverage thins. Pilot RMSE ±1.9 bw/s; residual bias −1.3 returned raw (not corrected). " +
  "Use the result to seed update_lbss_ci_table (future). CP is required — ask the athlete " +
  "or read it from Intervals power settings.";

export const estimateCriticalImpactTool: ToolDef = {
  name: "estimate_critical_impact",
  title: "Estimate Critical Impact",
  description: ILR_TYPES_NOTE,
  schema: {
    cp_watts: z
      .number()
      .int()
      .min(100)
      .max(600)
      .describe(
        "Current Critical Power in watts. Required — ask the athlete or read from " +
          "Intervals power settings.",
      ),
    as_of: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        "Estimate CI as of this date (YYYY-MM-DD). Defaults to today. Useful for backtesting.",
      ),
    window_days: z
      .number()
      .int()
      .min(14)
      .max(365)
      .optional()
      .describe("Lookback window. 90 (default) validated best; shorter windows are unstable."),
    gear_id: z
      .string()
      .optional()
      .describe(
        "Restrict regression to activities assigned to this gear id (pooled per-gear estimate).",
      ),
  },
  handler: async (
    { cp_watts, as_of, window_days, gear_id }: {
      cp_watts: number;
      as_of?: string;
      window_days?: number;
      gear_id?: string;
    },
    ctx?: ToolContext,
  ) => {
    // Zod .default() is unreliable over the MCP transport (CLAUDE.md) → ?? fallback.
    const windowDays = window_days ?? DEFAULT_WINDOW_DAYS;
    const asOf = as_of ?? today(config_.timezone);
    const oldest = addDays(asOf, -windowDays);
    const ilrField = config_.ilrField;

    const rawActivities = (await intervalsClient.getActivities(oldest, asOf, {
      signal: ctx?.signal,
    })) as Array<Activity & { gear?: { id?: string } }>;

    // Runs/treadmill runs only, on or before as_of, optionally one gear.
    const activities = rawActivities.filter((a) => {
      if (!RUN_TYPES.has(a.type)) return false;
      if (a.start_date_local.slice(0, 10) > asOf) return false;
      if (gear_id !== undefined && a.gear?.id !== gear_id) return false;
      return true;
    });

    // Fetch streams (bounded concurrency; superset + 429 retry handled in client).
    const perActivity = await mapWithConcurrency(activities, FETCH_CONCURRENCY, async (a) => {
      const streams = await intervalsClient.getActivityStreams(
        a.id,
        ["time", "watts", "altitude", "distance", ilrField],
        { signal: ctx?.signal },
      );
      const raw = streamsToMap(streams);
      const ilr = raw.get(ilrField);
      const hasIlr = !!ilr && ilr.some((v) => v !== null);

      const canonical: StreamMap = new Map();
      const watts = raw.get("watts");
      const altitude = raw.get("altitude");
      const distance = raw.get("distance");
      if (watts) canonical.set("watts", watts);
      if (ilr) canonical.set("ilr", ilr);
      if (altitude) canonical.set("altitude", altitude);
      if (distance) canonical.set("distance", distance);

      const isVirtual = a.type === "VirtualRun";
      const bins = buildFlatBins(canonical, isVirtual);
      return { activity: a, bins, hasIlr, isVirtual };
    });

    // Classify coverage.
    const binsByActivity: FlatBin[][] = [];
    const usedDates: string[] = [];
    let skippedNoIlr = 0;
    let skippedNoAltitude = 0;
    for (const r of perActivity) {
      if (r.bins === null) {
        if (!r.hasIlr) skippedNoIlr++;
        else skippedNoAltitude++; // outdoor run with no altitude stream
        continue;
      }
      binsByActivity.push(r.bins);
      usedDates.push(r.activity.start_date_local.slice(0, 10));
    }

    const oldestUsed = usedDates.length > 0 ? usedDates.reduce((m, d) => (d < m ? d : m)) : null;
    const historyDays = oldestUsed
      ? Math.round((parseDate(asOf).getTime() - parseDate(oldestUsed).getTime()) / 86_400_000)
      : 0;

    const est = estimateCi(binsByActivity, cp_watts, {
      loFrac: CI_BAND_LO,
      hiFrac: CI_BAND_HI,
      historyDays,
    });

    const warnings: string[] = [];
    if (!est.quality.historyOk) {
      warnings.push("history < 60 days — cold start, estimate unreliable");
    }
    if (!est.quality.binsOk || !est.quality.powerRangeOk) {
      warnings.push("intensity coverage thin (taper?) — pooled estimate may break down");
    }
    // Coverage warnings (§4): fire even when the gates pass, because a fit on few
    // flat-seconds / few activities is gear/context-biased and should be treated
    // as indicative — the gates don't catch this.
    if (est.regression && est.regression.nPointsWeight < THIN_POINTS_WEIGHT) {
      warnings.push(
        `thin data: only ${est.regression.nPointsWeight}s of flat seconds — treat as indicative`,
      );
    }
    if (binsByActivity.length < FEW_ACTIVITIES) {
      warnings.push(`few activities (${binsByActivity.length}) — gear/context bias possible`);
    }

    return {
      ci_estimate: est.ciEstimate,
      cp_watts,
      as_of: asOf,
      window_days: windowDays,
      ...(gear_id !== undefined ? { gear_id } : {}),
      regression: est.regression
        ? {
            intercept_a: Math.round(est.regression.interceptA * 1000) / 1000,
            slope_b: Math.round(est.regression.slopeB * 1000000) / 1000000,
            n_bins: est.regression.nBins,
            n_points_weight: est.regression.nPointsWeight,
            power_range_w: Math.round(est.regression.powerRangeW * 10) / 10,
          }
        : null,
      coverage: {
        n_activities_used: binsByActivity.length,
        n_activities_skipped_no_ilr: skippedNoIlr,
        n_activities_skipped_no_altitude: skippedNoAltitude,
        history_days: historyDays,
      },
      quality: {
        ok: est.quality.ok,
        gates: {
          bins_ok: est.quality.binsOk,
          power_range_ok: est.quality.powerRangeOk,
          history_ok: est.quality.historyOk,
        },
        warnings,
      },
      notes: [
        "Pilot-validated RMSE ±1.9 bw/s (warmup ≥60d, n=102).",
        "Residual bias −1.3 bw/s is NOT auto-corrected — ci_estimate is the raw regression value.",
        "CP sensitivity ≈0.3 bw/s per watt — re-estimate CI after a CP test.",
        "Pooled estimate reflects the trailing window's intensity & gear mix — taper/recovery windows skew low even when quality gates pass. Cross-check with gear_id filter or an earlier as_of.",
      ],
    };
  },
};
