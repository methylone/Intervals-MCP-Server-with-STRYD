// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { config_ } from "../../config.js";
import { intervalsClient } from "../intervals-client.js";
import { SUMMARY_STREAM_TYPES } from "../stream-types.js";
import type { ToolDef, ToolContext } from "../../tool-registry.js";
import {
  streamsToMap,
  buildValidMask,
  calcMovingTime,
  splitByMovingTime,
  splitByDistance,
  splitByBreakpoints,
  avgInRange,
  percentileInRange,
  velocityToPace,
  calcDecoupling,
  calcZoneTimes,
  strideLengthM,
  buildRunMask,
  countInRange,
  DEFAULT_RUN_GATE_CADENCE_RPM,
} from "../../utils/stream-processing.js";

type SplitMethod = "halves" | "thirds" | "quarters" | "km" | "custom" | "segments";

function resolveSplitMethod(method: string, analyzedMovingSec: number): SplitMethod {
  if (method !== "auto") return method as SplitMethod;
  if (analyzedMovingSec < 90 * 60) return "halves";
  if (analyzedMovingSec < 180 * 60) return "thirds";
  return "quarters";
}

function splitMethodToCount(method: SplitMethod): number {
  switch (method) {
    case "halves": return 2;
    case "thirds": return 3;
    case "quarters": return 4;
    case "km": return -1; // special: distance-based
    case "custom": return -1; // special: breakpoint-based
    case "segments": return -1; // special: count from segment_count param
  }
}

function splitLabel(method: SplitMethod, idx: number): string {
  switch (method) {
    case "halves": return `H${idx + 1}`;
    case "thirds": return `T${idx + 1}`;
    case "quarters": return `Q${idx + 1}`;
    case "km": return `${idx + 1}km`;
    case "custom": return `S${idx + 1}`; // fallback, overridden below
    case "segments": return `S${idx + 1}`;
  }
}

function customSplitLabel(breakpoints: number[], idx: number): string {
  const bps = [0, ...breakpoints];
  const startKm = (bps[idx] / 1000).toFixed(1);
  const endKm = idx < breakpoints.length
    ? (breakpoints[idx] / 1000).toFixed(1)
    : "end";
  return `${startKm}-${endKm}km`;
}

export const getStreamsSummaryTool: ToolDef = {
  name: "get_activity_streams_summary",
  title: "Get Activity Streams Summary",
  description:
    "Fetch activity stream data, clean/split/aggregate, and return a summary with splits, " +
    "cardiac decoupling, and efficiency metrics. " +
    "Each split and the overall block also carry avg_ilr and ilr_p95 (from the configured ILR field): " +
    "avg flags walk/soft-surface dilution, p95 captures the impact tail (eccentric loading) per segment. " +
    "Each split and overall include avg_stride_length_m (meters per step, derived as speed / step rate) — " +
    "use together with avg_cadence to decompose pace changes into cadence vs stride-length components. " +
    "When EXTRA_STREAM_FIELDS is configured, each split and overall also carry an extras record with per-split " +
    "averages for those Intervals custom streams (e.g. StrydLSS, StrydTemp, StrydHumidity). " +
    "Note: StrydTemp is foot-mounted and reads several degrees C above ambient — use for relative " +
    "within-run / run-to-run comparison, not absolute values. It is a different sensor from the native " +
    "temp stream; do not mix the two. " +
    "When cadence data is present, each split and overall also include run_fraction (share of valid samples " +
    "above the run-gate cadence threshold) and, when extras are configured, extras_run (extras averages " +
    "restricted to running samples only). Core averages (avg_cadence, avg_stride_length_m, etc.) " +
    "intentionally include the walk/run mix — pace decomposition analysis uses the full mix. " +
    "For stiffness metrics like StrydLSS, read extras_run to separate per-stride change from walk-mix " +
    "dilution; compare run_fraction across splits to see gait-mix drift.",
  schema: {
    activity_id: z
          .string()
          .min(1)
          .refine(
            (s) => !/\s/.test(s) && !/[^\x20-\x7E]/.test(s),
            "This looks like an activity name, not an ID. " +
            "Call get_activities first to get the activity_id field (e.g. 'i12345678')."
          )
          .describe(
            "Intervals.icu activity ID — a short alphanumeric string like 'i12345678', " +
            "NOT the activity name. Call get_activities first to obtain IDs."
          ),
        split_method: z
          .enum(["auto", "halves", "thirds", "quarters", "km", "custom", "segments"])
          .default("auto")
          .describe(
            'Split method. "auto" chooses based on duration: <90min→halves, <3h→thirds, ≥3h→quarters. ' +
            '"segments" splits into N equal parts by moving time (set segment_count). ' +
            '"custom" uses split_breakpoints_m.'
          ),
        segment_count: z
          .number()
          .int()
          .min(2)
          .max(20)
          .optional()
          .describe(
            'Number of equal segments when split_method="segments". Required for segments, ignored otherwise. ' +
            'Range: 2-20.'
          ),
        split_breakpoints_m: z
          .array(z.number())
          .optional()
          .describe(
            'Distance breakpoints in meters for custom splits. ' +
            'Required when split_method="custom". ' +
            'Example: [6000, 12200, 31300] creates segments 0-6km, 6-12.2km, 12.2-31.3km, 31.3km-end'
          ),
        warmup_exclude_sec: z
          .number()
          .default(600)
          .describe("Seconds to exclude from start as warmup (default: 600 = 10 min)"),
        post_stop_buffer_sec: z
          .number()
          .default(30)
          .describe("Seconds to exclude after each stop segment (default: 30)"),
        power_zone_boundaries: z
          .array(z.number())
          .optional()
          .describe(
            "Custom power zone boundaries in watts, ascending order. " +
            "Example: [143, 174, 187, 200, 220] creates 6 zones: <143, 143-174, 174-187, 187-200, 200-220, >220. " +
            "If omitted, custom power zone analysis is skipped."
          ),
        hr_zone_boundaries: z
          .array(z.number())
          .optional()
          .describe(
            "Custom HR zone boundaries in bpm, ascending order. " +
            "Example: [131, 139, 146, 155] creates 5 zones: <131, 131-139, 139-146, 146-155, >155. " +
            "If omitted, custom HR zone analysis is skipped."
          ),
        run_gate_cadence_rpm: z
          .number()
          .min(40)
          .max(120)
          .default(DEFAULT_RUN_GATE_CADENCE_RPM)
          .describe(
            "Cadence threshold (rpm, one-foot) used to gate running samples for run_fraction and extras_run. " +
            "70 rpm = 140 spm (default). Increase to tighten the run gate (exclude slow shuffles); " +
            "decrease to loosen it. Requires cadence stream to have any effect."
          ),
  },
  handler: async ({ activity_id, split_method, split_breakpoints_m, segment_count, warmup_exclude_sec, post_stop_buffer_sec, power_zone_boundaries, hr_zone_boundaries, run_gate_cadence_rpm }: {
      activity_id: string;
      split_method: "auto" | "halves" | "thirds" | "quarters" | "km" | "custom" | "segments";
      split_breakpoints_m?: number[];
      segment_count?: number;
      warmup_exclude_sec: number;
      post_stop_buffer_sec: number;
      power_zone_boundaries?: number[];
      hr_zone_boundaries?: number[];
      run_gate_cadence_rpm: number;
    }, ctx?: ToolContext) => {
      // Defaults applied by the adapter's parseAsync (warmup=600, post_stop=30, split_method="auto").
      const warmupExcludeSec = warmup_exclude_sec;
      const postStopBufferSec = post_stop_buffer_sec;
      const splitMethodParam = split_method;
      const splitBreakpointsM = split_breakpoints_m;
      // Zod .default() is not applied when the handler is called directly (e.g. in tests).
      const runGateCadenceRpm = run_gate_cadence_rpm ?? DEFAULT_RUN_GATE_CADENCE_RPM;

      // Read the configured ILR field name here (handler), NOT at module load —
      // config_ is a lazy Proxy and reading it at import time would break the
      // credential-free paths. The ILR field is appended to requiredTypes; the
      // fetch already pulls the canonical superset (which includes it), so the
      // v2 cache entry stays a hit (requiredTypes ⊆ recorded request set).
      const ilrField = config_.ilrField;
      // Extra custom stream codes (same lazy discipline as ilrField above).
      const extraStreamFields = config_.extraStreamFields;

      // Stage 1: Fetch streams and activity name in parallel
      const [streams, activityRaw] = await Promise.all([
        intervalsClient.getActivityStreams(activity_id, [...SUMMARY_STREAM_TYPES, ilrField, ...extraStreamFields], { signal: ctx?.signal }),
        intervalsClient.getActivityDetail(activity_id, { signal: ctx?.signal }),
      ]);

      const activity = activityRaw as { name?: string; has_weather?: boolean };
      const activityName = activity.name ?? "";
      const hasWeather = activity.has_weather === true;

      const streamMap = streamsToMap(streams);

      const time = (streamMap.get("time") ?? []).filter((v): v is number => v !== null);
      if (time.length === 0) {
        throw new Error("No time stream data available for this activity.");
      }

      const velocity = streamMap.get("velocity_smooth") ?? [];
      const hr = streamMap.get("fixed_heartrate") ?? [];
      const distanceStream = streamMap.get("distance") ?? [];
      const gaVelocity = streamMap.get("ga_velocity") ?? [];
      const watts = streamMap.get("fixed_watts") ?? [];
      const cadence = streamMap.get("cadence") ?? [];
      const gradeSmooth = streamMap.get("grade_smooth") ?? new Array(time.length).fill(null);
      const ilr = streamMap.get(ilrField) ?? new Array(time.length).fill(null);
      // Extra custom streams: Map<code, data[]>. Only populated when configured.
      const extraStreams = new Map<string, (number | null)[]>(
        extraStreamFields.map((code) => [
          code,
          streamMap.get(code) ?? new Array(time.length).fill(null),
        ]),
      );

      // Detect optional stream availability
      const hasGap = gaVelocity.some((v) => v !== null);
      const hasPower = watts.some((v) => v !== null);
      const hasGrade = streamMap.has("grade_smooth");
      const hasIlr = streamMap.has(ilrField);
      const hasCadence = cadence.some((v) => v !== null);

      // Stage 2: Build valid mask (stop detection + warmup exclusion)
      const maskResult = buildValidMask(time, velocity, {
        warmupExcludeSec: warmupExcludeSec,
        postStopBufferSec: postStopBufferSec,
      });
      const { validMask, timeGaps, stopSegments, stoppedTimeSec, bufferTimeSec } = maskResult;
      // Run-gate mask: subset of validMask where cadence >= threshold.
      // Only built when cadence stream has data; otherwise null (no gate features emitted).
      const runMask = hasCadence
        ? buildRunMask(validMask, cadence, runGateCadenceRpm)
        : null;

      // Stage 3 & 4: Compute timing metrics
      const totalElapsedSec = time[time.length - 1] - time[0];

      // total_moving_sec: 停止除外後の移動時間（warmup 除外なし）
      // PAUSE ギャップを正しく除外するため、calcMovingTime で直接計算する
      const { validMask: stopOnlyMask } = buildValidMask(time, velocity, {
        warmupExcludeSec: 0,
        postStopBufferSec: postStopBufferSec,
      });
      const totalMovingSec = calcMovingTime(time, stopOnlyMask);
      const analyzedMovingSec = calcMovingTime(time, validMask);

      // Stage 5: Resolve split method
      const resolvedMethod = resolveSplitMethod(splitMethodParam, totalMovingSec);

      // Stage 6: Split
      let splitRanges: Array<{ startIdx: number; endIdx: number }>;
      if (resolvedMethod === "custom") {
        if (!splitBreakpointsM || splitBreakpointsM.length === 0) {
          throw new Error("split_breakpoints_m is required when split_method is 'custom'");
        }
        splitRanges = splitByBreakpoints(distanceStream, validMask, splitBreakpointsM);
      } else if (resolvedMethod === "km") {
        splitRanges = splitByDistance(distanceStream, validMask, 1000);
      } else if (resolvedMethod === "segments") {
        const count = segment_count ?? 4;
        splitRanges = splitByMovingTime(time, validMask, count);
      } else {
        splitRanges = splitByMovingTime(time, validMask, splitMethodToCount(resolvedMethod));
      }

      // Stage 6: Aggregate per split
      const splits = splitRanges.map((range, idx) => {
        const { startIdx, endIdx } = range;

        const avgHr = avgInRange(hr, validMask, startIdx, endIdx);
        const avgVel = avgInRange(velocity, validMask, startIdx, endIdx);
        const avgGapVel = hasGap ? avgInRange(gaVelocity, validMask, startIdx, endIdx) : null;
        const avgPower = hasPower ? avgInRange(watts, validMask, startIdx, endIdx) : null;
        const avgCad = avgInRange(cadence, validMask, startIdx, endIdx);
        const avgGrade = hasGrade ? avgInRange(gradeSmooth, validMask, startIdx, endIdx) : null;
        const avgIlr = hasIlr ? avgInRange(ilr, validMask, startIdx, endIdx) : null;
        const ilrP95 = hasIlr ? percentileInRange(ilr, validMask, startIdx, endIdx, 95) : null;

        const paceSec = avgVel !== null && avgVel > 0 ? velocityToPace(avgVel) : null;
        const gapPaceSec = avgGapVel !== null && avgGapVel > 0 ? velocityToPace(avgGapVel) : null;

        const efPace =
          paceSec !== null && avgHr !== null && avgHr > 0
            ? (1000 / paceSec) / avgHr
            : null;
        const efPower =
          hasPower && avgPower !== null && avgHr !== null && avgHr > 0
            ? avgPower / avgHr
            : null;

        // duration_sec: moving time within split (same logic as calcMovingTime, 5s gap cap)
        let splitDurationSec = 0;
        for (let i = startIdx; i < endIdx; i++) {
          if (validMask[i] && validMask[i + 1]) {
            const gap = time[i + 1] - time[i];
            if (gap <= 5) splitDurationSec += gap;
          }
        }
        const startDist = distanceStream[startIdx];
        const endDist = distanceStream[endIdx];
        const splitDistanceM =
          startDist !== null && endDist !== null ? (endDist as number) - (startDist as number) : 0;

        // Compute per-split averages for extra custom streams (omit key entirely
        // when no extras are configured to keep output backward-compatible).
        const extrasEntry =
          extraStreamFields.length > 0
            ? Object.fromEntries(
                extraStreamFields.map((code) => {
                  const raw = avgInRange(extraStreams.get(code)!, validMask, startIdx, endIdx);
                  return [code, raw !== null ? Math.round(raw * 100) / 100 : null];
                }),
              )
            : undefined;

        // run_fraction: share of valid samples above run-gate cadence threshold.
        const validCount = countInRange(validMask, startIdx, endIdx);
        const runCount = runMask ? countInRange(runMask, startIdx, endIdx) : null;
        const runFractionSplit =
          runMask !== null
            ? validCount > 0
              ? Math.round((runCount! / validCount) * 100) / 100
              : null
            : undefined;

        // extras_run: extras averages restricted to running samples only.
        // Suppress (all null) for splits with < 60 run samples to avoid noisy averages.
        const extrasRunEntry =
          runMask !== null && extraStreamFields.length > 0
            ? Object.fromEntries(
                extraStreamFields.map((code) => {
                  if (runCount! < 60) return [code, null];
                  const raw = avgInRange(extraStreams.get(code)!, runMask, startIdx, endIdx);
                  return [code, raw !== null ? Math.round(raw * 100) / 100 : null];
                }),
              )
            : undefined;

        return {
          label: resolvedMethod === "custom"
            ? customSplitLabel(splitBreakpointsM!, idx)
            : splitLabel(resolvedMethod, idx),
          duration_sec: splitDurationSec,
          distance_m: Math.round(splitDistanceM),
          avg_hr: avgHr !== null ? Math.round(avgHr) : 0,
          avg_pace_sec_per_km: paceSec !== null ? Math.round(paceSec) : 0,
          avg_gap_sec_per_km: hasGap
            ? gapPaceSec !== null ? Math.round(gapPaceSec) : null
            : null,
          avg_power: hasPower
            ? avgPower !== null ? Math.round(avgPower) : null
            : null,
          avg_cadence:
            avgCad !== null ? Math.round(avgCad * 10) / 10 : null,
          avg_stride_length_m: (() => {
            const sl = strideLengthM(avgVel, avgCad);
            return sl !== null ? Math.round(sl * 100) / 100 : null;
          })(),
          avg_grade: hasGrade
            ? avgGrade !== null ? Math.round(avgGrade * 100) / 100 : null
            : null,
          avg_ilr: hasIlr
            ? avgIlr !== null ? Math.round(avgIlr * 100) / 100 : null
            : null,
          ilr_p95: hasIlr
            ? ilrP95 !== null ? Math.round(ilrP95 * 100) / 100 : null
            : null,
          ef_pace: efPace !== null ? Math.round(efPace * 10000) / 10000 : 0,
          ef_power: hasPower && efPower !== null ? Math.round(efPower * 100) / 100 : null,
          ...(runFractionSplit !== undefined ? { run_fraction: runFractionSplit } : {}),
          ...(extrasEntry !== undefined ? { extras: extrasEntry } : {}),
          ...(extrasRunEntry !== undefined ? { extras_run: extrasRunEntry } : {}),
        };
      });

      // Overall metrics (across all valid data)
      const validIndices: number[] = [];
      for (let i = 0; i < time.length; i++) {
        if (validMask[i]) validIndices.push(i);
      }
      const overallStart = validIndices.length > 0 ? validIndices[0] : 0;
      const overallEnd = validIndices.length > 0 ? validIndices[validIndices.length - 1] : 0;

      const overallAvgHr = avgInRange(hr, validMask, overallStart, overallEnd);
      const overallAvgVel = avgInRange(velocity, validMask, overallStart, overallEnd);
      const overallAvgGapVel = hasGap ? avgInRange(gaVelocity, validMask, overallStart, overallEnd) : null;
      const overallAvgPower = hasPower ? avgInRange(watts, validMask, overallStart, overallEnd) : null;
      const overallAvgCad = avgInRange(cadence, validMask, overallStart, overallEnd);
      const overallAvgGrade = hasGrade ? avgInRange(gradeSmooth, validMask, overallStart, overallEnd) : null;
      const overallAvgIlr = hasIlr ? avgInRange(ilr, validMask, overallStart, overallEnd) : null;
      const overallIlrP95 = hasIlr ? percentileInRange(ilr, validMask, overallStart, overallEnd, 95) : null;
      const overallExtras =
        extraStreamFields.length > 0
          ? Object.fromEntries(
              extraStreamFields.map((code) => {
                const raw = avgInRange(extraStreams.get(code)!, validMask, overallStart, overallEnd);
                return [code, raw !== null ? Math.round(raw * 100) / 100 : null];
              }),
            )
          : undefined;
      // Which of the configured extra codes are actually present in the response.
      const extraStreamsPresent =
        extraStreamFields.length > 0
          ? extraStreamFields.filter((code) => streamMap.has(code))
          : undefined;

      // Overall run_fraction and extras_run.
      const overallValidCount = countInRange(validMask, overallStart, overallEnd);
      const overallRunCount = runMask ? countInRange(runMask, overallStart, overallEnd) : null;
      const overallRunFraction =
        runMask !== null
          ? overallValidCount > 0
            ? Math.round((overallRunCount! / overallValidCount) * 100) / 100
            : null
          : undefined;
      const overallExtrasRun =
        runMask !== null && extraStreamFields.length > 0
          ? Object.fromEntries(
              extraStreamFields.map((code) => {
                if (overallRunCount! < 60) return [code, null];
                const raw = avgInRange(extraStreams.get(code)!, runMask, overallStart, overallEnd);
                return [code, raw !== null ? Math.round(raw * 100) / 100 : null];
              }),
            )
          : undefined;

      const overallPaceSec = overallAvgVel !== null && overallAvgVel > 0
        ? velocityToPace(overallAvgVel)
        : null;
      const overallGapPaceSec = overallAvgGapVel !== null && overallAvgGapVel > 0
        ? velocityToPace(overallAvgGapVel)
        : null;
      const overallEfPace =
        overallPaceSec !== null && overallAvgHr !== null && overallAvgHr > 0
          ? (1000 / overallPaceSec) / overallAvgHr
          : null;
      const overallEfPower =
        hasPower && overallAvgPower !== null && overallAvgHr !== null && overallAvgHr > 0
          ? overallAvgPower / overallAvgHr
          : null;

      // Stage 7: Cardiac decoupling (always halves)
      const decouplingPace = calcDecoupling(time, hr, velocity, validMask);
      const decouplingPower = hasPower ? calcDecoupling(time, hr, watts, validMask) : null;

      // ── Custom zone analysis ──────────────────────────────────────────
      let customZoneTimes: Record<string, unknown> | undefined;

      if (power_zone_boundaries || hr_zone_boundaries) {
        customZoneTimes = {};

        if (power_zone_boundaries && power_zone_boundaries.length > 0 && hasPower) {
          const pzResult = calcZoneTimes(time, watts, validMask, power_zone_boundaries);
          const powerZones = pzResult.zones.map((secs, i) => {
            const entry: Record<string, unknown> = { zone: i, secs };
            if (i === 0) {
              entry.below = power_zone_boundaries[0];
            } else if (i < power_zone_boundaries.length) {
              entry.from = power_zone_boundaries[i - 1];
              entry.to = power_zone_boundaries[i];
            } else {
              entry.above = power_zone_boundaries[power_zone_boundaries.length - 1];
            }
            entry.pct = pzResult.totalClassifiedSecs > 0
              ? Math.round((secs / pzResult.totalClassifiedSecs) * 1000) / 10
              : 0;
            return entry;
          });
          (customZoneTimes as Record<string, unknown>).power = {
            boundaries: power_zone_boundaries,
            zones: powerZones,
            total_classified_secs: pzResult.totalClassifiedSecs,
          };
        }

        if (hr_zone_boundaries && hr_zone_boundaries.length > 0) {
          const hzResult = calcZoneTimes(time, hr, validMask, hr_zone_boundaries);
          const hrZones = hzResult.zones.map((secs, i) => {
            const entry: Record<string, unknown> = { zone: i, secs };
            if (i === 0) {
              entry.below = hr_zone_boundaries[0];
            } else if (i < hr_zone_boundaries.length) {
              entry.from = hr_zone_boundaries[i - 1];
              entry.to = hr_zone_boundaries[i];
            } else {
              entry.above = hr_zone_boundaries[hr_zone_boundaries.length - 1];
            }
            entry.pct = hzResult.totalClassifiedSecs > 0
              ? Math.round((secs / hzResult.totalClassifiedSecs) * 1000) / 10
              : 0;
            return entry;
          });
          (customZoneTimes as Record<string, unknown>).hr = {
            boundaries: hr_zone_boundaries,
            zones: hrZones,
            total_classified_secs: hzResult.totalClassifiedSecs,
          };
        }
      }

      const result = {
        activity_id,
        activity_name: activityName,
        total_elapsed_sec: Math.round(totalElapsedSec),
        total_moving_sec: Math.round(totalMovingSec),
        analyzed_sec: Math.round(analyzedMovingSec),

        cardiac_decoupling_pct: decouplingPace !== null ? Math.round(decouplingPace * 100) / 100 : null,
        cardiac_decoupling_power_pct: hasPower
          ? decouplingPower !== null ? Math.round(decouplingPower * 100) / 100 : null
          : null,

        overall: {
          avg_hr: overallAvgHr !== null ? Math.round(overallAvgHr) : null,
          avg_pace_sec_per_km: overallPaceSec !== null ? Math.round(overallPaceSec) : null,
          avg_gap_sec_per_km: hasGap
            ? overallGapPaceSec !== null ? Math.round(overallGapPaceSec) : null
            : null,
          avg_power: hasPower
            ? overallAvgPower !== null ? Math.round(overallAvgPower) : null
            : null,
          avg_cadence: overallAvgCad !== null ? Math.round(overallAvgCad * 10) / 10 : null,
          avg_stride_length_m: (() => {
            const sl = strideLengthM(overallAvgVel, overallAvgCad);
            return sl !== null ? Math.round(sl * 100) / 100 : null;
          })(),
          avg_grade: hasGrade
            ? overallAvgGrade !== null ? Math.round(overallAvgGrade * 100) / 100 : null
            : null,
          avg_ilr: hasIlr
            ? overallAvgIlr !== null ? Math.round(overallAvgIlr * 100) / 100 : null
            : null,
          ilr_p95: hasIlr
            ? overallIlrP95 !== null ? Math.round(overallIlrP95 * 100) / 100 : null
            : null,
          ef_pace: overallEfPace !== null ? Math.round(overallEfPace * 10000) / 10000 : null,
          ef_power: hasPower && overallEfPower !== null
            ? Math.round(overallEfPower * 100) / 100
            : null,
          ...(overallRunFraction !== undefined ? { run_fraction: overallRunFraction } : {}),
          ...(overallExtras !== undefined ? { extras: overallExtras } : {}),
          ...(overallExtrasRun !== undefined ? { extras_run: overallExtrasRun } : {}),
        },

        split_method: resolvedMethod,
        splits,

        // カスタムゾーン分析（パラメータが指定された場合のみ）
        ...(customZoneTimes ? { custom_zone_times: customZoneTimes } : {}),

        data_quality: {
          total_data_points: time.length,
          time_gaps_detected: timeGaps,
          stop_segments_excluded: stopSegments,
          stopped_time_excluded_sec: Math.round(stoppedTimeSec),
          warmup_excluded_sec: warmupExcludeSec,
          post_stop_buffer_excluded_sec: Math.round(bufferTimeSec),
          clean_data_ratio:
            totalMovingSec > 0
              ? Math.round((analyzedMovingSec / totalMovingSec) * 1000) / 1000
              : null,
          has_power: hasPower,
          has_gap: hasGap,
          has_grade: hasGrade,
          has_ilr: hasIlr,
          has_weather: hasWeather,
          ...(extraStreamsPresent !== undefined ? { extra_streams_present: extraStreamsPresent } : {}),
          ...(runMask !== null ? { run_gate_cadence_rpm: runGateCadenceRpm } : {}),
        },
      };

    return result;
  },
};
