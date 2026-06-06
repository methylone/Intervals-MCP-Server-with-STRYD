// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCPツール: get_weekly_summary
 *
 * 指定週のトレーニングサマリーを返す。
 *
 * 集計内容:
 * - 週合計: RSS, LBSS, 時間, 距離
 * - 平均: ILR, デカップリング
 * - 週末時点の PMC: RSS 系（wellness から）/ LBSS 系（自前 EMA）
 * - セッション一覧
 */

import { z } from "zod";
import type { ToolDef, ToolContext } from "../../../tool-registry.js";
import { intervalsClient } from "../../../core/intervals-client.js";
import type { Activity, Wellness } from "../../../core/types.js";
import { addDays } from "../../../utils/date.js";
import { computeLbssPmc } from "../lbss-calculator.js";

/** LBSS EMA の cold-start バイアスを 1% 未満に抑える助走期間（日数）*/
const WARMUP_DAYS = 180;

/** 数値配列の平均を返す。空配列の場合は null。*/
function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** アクティビティ配列から特定フィールドの数値のみ抽出する。*/
function collectNumbers(
  activities: Activity[],
  getter: (a: Activity) => unknown,
): number[] {
  return activities
    .map(getter)
    .filter((v): v is number => typeof v === "number");
}

/** 小数点 n 桁で四捨五入する。null は null のまま返す。*/
function round(value: number | null, decimals: number): number | null {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export const getWeeklySummaryTool: ToolDef = {
  name: "get_weekly_summary",
  title: "Get Weekly Summary",
  description:
    "Get a weekly training summary for a given week (Mon–Sun). " +
    "Returns:\n" +
    "- totals: RSS, LBSS, total time (min), total distance (km)\n" +
    "- averages: ILR, decoupling (from sessions that have the field)\n" +
    "- pmc_end_of_week: CTL/ATL/TSB at Sunday for both RSS and LBSS\n" +
    "- sessions: per-activity breakdown sorted by date\n" +
    "Note: LBSS values require Stryd data synced to Intervals (post Nov 2025).",
  schema: {
    week_start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .describe("Monday of the target week (YYYY-MM-DD)"),
  },
  handler: async ({ week_start: weekStart }: { week_start: string }, ctx?: ToolContext) => {
      const weekEnd = addDays(weekStart, 6); // Sunday
      const warmupStart = addDays(weekStart, -WARMUP_DAYS);

      // wellness（週内のみ）と activities（助走含む）を並列取得
      const [rawActivities, rawWellness] = await Promise.all([
        intervalsClient.getActivities(warmupStart, weekEnd, { signal: ctx?.signal }),
        intervalsClient.getWellness(weekStart, weekEnd, { signal: ctx?.signal }),
      ]);

      const allActivities = rawActivities as Activity[];
      const weekWellness = rawWellness as Wellness[];

      // 週内のアクティビティのみ抽出（助走期間分を除外）
      const weekActivities = allActivities.filter((a) => {
        const date = a.start_date_local.slice(0, 10);
        return date >= weekStart && date <= weekEnd;
      });

      // ── 週合計 ──────────────────────────────────────────────────────────
      const totals = {
        rss: round(
          weekActivities.reduce((s, a) => s + (a.icu_training_load ?? 0), 0),
          1,
        ),
        lbss: round(
          weekActivities.reduce((s, a) => s + (a.StrydLBSSmod ?? 0), 0),
          1,
        ),
        time_min: Math.round(
          weekActivities.reduce((s, a) => s + a.moving_time, 0) / 60,
        ),
        distance_km: round(
          weekActivities.reduce((s, a) => s + a.distance, 0) / 1000,
          1,
        ),
      };

      // ── 平均値（当該フィールドを持つセッションのみ対象）──────────────
      const averages = {
        ilr: round(
          avg(collectNumbers(weekActivities, (a) => a.StrydILR)),
          2,
        ),
        decoupling: round(
          avg(collectNumbers(weekActivities, (a) => a.decoupling)),
          1,
        ),
      };

      // ── 週末時点の PMC ───────────────────────────────────────────────────
      // RSS 系: 週内の最新 wellness エントリを使用
      const latestRss = [...weekWellness].reverse().find((w) => w.ctl != null);
      const rssCtl = round(latestRss?.ctl ?? 0, 1);
      const rssAtl = round(latestRss?.atl ?? 0, 1);
      const pmcRss = {
        ctl: rssCtl,
        atl: rssAtl,
        // Intervals の tsb フィールドは使わず CTL - ATL で統一
        tsb: round((rssCtl ?? 0) - (rssAtl ?? 0), 1),
        as_of: latestRss?.id ?? null,
      };

      // LBSS 系: 助走期間含む全アクティビティから EMA を計算し週末値を取得
      const lbssSeries = computeLbssPmc(allActivities, warmupStart, weekEnd);
      const lbssEnd = lbssSeries.at(-1);
      const pmcLbss = {
        ctl: round(lbssEnd?.ctl ?? 0, 1),
        atl: round(lbssEnd?.atl ?? 0, 1),
        tsb: round(lbssEnd?.tsb ?? 0, 1),
      };

      // ── セッション一覧（週内のみ、日付昇順）──────────────────────────
      const sessions = weekActivities
        .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local))
        .map((a) => ({
          date: a.start_date_local.slice(0, 10),
          name: a.name,
          type: a.type,
          rss: round(a.icu_training_load ?? null, 1),
          lbss: round(a.StrydLBSSmod ?? null, 1),
          ilr: round(a.StrydILR ?? null, 2),
          duration_min: Math.round(a.moving_time / 60),
          distance_km: round(a.distance / 1000, 2),
          decoupling: round(a.decoupling ?? null, 1),
        }));

      const result = {
        week_start: weekStart,
        week_end: weekEnd,
        session_count: weekActivities.length,
        totals,
        averages,
        pmc_end_of_week: { rss: pmcRss, lbss: pmcLbss },
        sessions,
      };

    return result;
  },
};
