// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Wellness } from "../core/types.js";
import { dateRange, addDays } from "./date.js";

export interface HrvTrendPoint {
  date: string;
  hrv_mean: number | null;
  hrv_sd: number | null;
  hrv_cv: number | null;
  rhr_mean: number | null;
  valid_days: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * wellness 配列から rolling HRV 統計量の時系列を計算する。
 *
 * @param wellness   - wellness データ配列（全期間分。助走期間を含む）
 * @param startDate  - 出力開始日 (YYYY-MM-DD, inclusive)
 * @param endDate    - 出力終了日 (YYYY-MM-DD, inclusive)
 * @param windowDays - rolling window 幅（デフォルト: 7）
 * @returns startDate〜endDate の各日の統計量。
 *          valid_days < ceil(windowDays / 2) の日は mean/sd/cv を null にする。
 */
export function computeHrvTrends(
  wellness: Wellness[],
  startDate: string,
  endDate: string,
  windowDays = 7,
): HrvTrendPoint[] {
  // Build date → wellness lookup
  const wellnessMap = new Map<string, Wellness>();
  for (const w of wellness) {
    wellnessMap.set(w.id, w);
  }

  const threshold = Math.ceil(windowDays / 2);
  const dates = dateRange(startDate, endDate);
  const results: HrvTrendPoint[] = [];

  for (const date of dates) {
    // Collect window data: [date - windowDays + 1, date]
    const windowStart = addDays(date, -(windowDays - 1));
    const windowDates = dateRange(windowStart, date);

    const hrvValues: number[] = [];
    const rhrValues: number[] = [];

    for (const wd of windowDates) {
      const w = wellnessMap.get(wd);
      if (w) {
        if (typeof w.hrv === "number") hrvValues.push(w.hrv);
        if (typeof w.restingHR === "number") rhrValues.push(w.restingHR);
      }
    }

    const validDays = hrvValues.length;

    if (validDays < threshold) {
      results.push({
        date,
        hrv_mean: null,
        hrv_sd: null,
        hrv_cv: null,
        rhr_mean: null,
        valid_days: validDays,
      });
      continue;
    }

    // HRV statistics
    const hrvMean = hrvValues.reduce((a, b) => a + b, 0) / validDays;
    const hrvVariance =
      hrvValues.reduce((sum, v) => sum + (v - hrvMean) ** 2, 0) / validDays;
    const hrvSd = Math.sqrt(hrvVariance);
    const hrvCv = hrvMean !== 0 ? (hrvSd / hrvMean) * 100 : 0;

    // RHR mean (only from days that have restingHR)
    const rhrMean =
      rhrValues.length > 0
        ? rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length
        : null;

    results.push({
      date,
      hrv_mean: round1(hrvMean),
      hrv_sd: round1(hrvSd),
      hrv_cv: round1(hrvCv),
      rhr_mean: rhrMean !== null ? round1(rhrMean) : null,
      valid_days: validDays,
    });
  }

  return results;
}
