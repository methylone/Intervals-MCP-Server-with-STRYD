// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCPツール: get_phase_summary
 *
 * 指定フェーズ期間の週別トレーニングサマリーを返す。
 *
 * 集計内容:
 * - フェーズ合計: RSS, LBSS, 時間, 距離, セッション数
 * - 週別: totals, session_count, averages (ILR, decoupling), PMC スナップショット
 * - trends: 週別 RSS/LBSS 系列 + ramp rate (CTL の週平均変化)
 *
 * API 呼び出しは2回のみ:
 *   1. getActivities(start_date - 180日, end_date) — LBSS EMA 助走用
 *   2. getWellness(start_date, end_date) — RSS PMC 用
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export function registerGetPhaseSummary(server: McpServer): void {
  server.registerTool(
    "get_phase_summary",
    {
      title: "Get Phase Summary",
      description:
        "Get a training phase summary with per-week breakdown and ramp rate analysis. " +
        "Returns:\n" +
        "- phase_totals: RSS, LBSS, total time (min), total distance (km), session count\n" +
        "- weeks: per-week breakdown with totals, session count, averages (ILR, decoupling), PMC snapshot\n" +
        "- trends: weekly RSS/LBSS series and CTL ramp rate (avg weekly CTL change)\n" +
        "Note: start_date must be a Monday, end_date must be a Sunday. " +
        "LBSS values require Stryd data synced to Intervals (post Nov 2025).",
      inputSchema: {
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Phase start date — Monday (YYYY-MM-DD)"),
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Phase end date — Sunday (YYYY-MM-DD)"),
        phase_name: z
          .string()
          .optional()
          .describe("Optional phase name (included in response as-is, not used for filtering)"),
      },
    },
    async ({ start_date: startDate, end_date: endDate, phase_name: phaseName }) => {
      const warmupStart = addDays(startDate, -WARMUP_DAYS);

      // API 呼び出しは2回のみ（並列）
      const [rawActivities, rawWellness] = await Promise.all([
        intervalsClient.getActivities(warmupStart, endDate),
        intervalsClient.getWellness(startDate, endDate),
      ]);

      const allActivities = rawActivities as Activity[];
      const phaseWellness = rawWellness as Wellness[];

      // フェーズ期間内のアクティビティのみ抽出（週別グループ化のため）
      const phaseActivities = allActivities.filter((a) => {
        const date = a.start_date_local.slice(0, 10);
        return date >= startDate && date <= endDate;
      });

      // LBSS PMC を全期間通しで1回計算（助走期間含む）→ 日付 → エントリの Map
      const lbssSeries = computeLbssPmc(allActivities, warmupStart, endDate);
      const lbssByDate = new Map(lbssSeries.map((e) => [e.date, e]));

      // wellness を日付（YYYY-MM-DD）でインデックス化
      const wellnessByDate = new Map(phaseWellness.map((w) => [w.id, w]));

      // ── 週の列挙 ────────────────────────────────────────────────────────────
      // start_date が月曜、end_date が日曜を前提に 7 日刻みで列挙
      const weekStarts: string[] = [];
      let cur = startDate;
      while (cur <= endDate) {
        weekStarts.push(cur);
        cur = addDays(cur, 7);
      }

      // ── 週別集計 ────────────────────────────────────────────────────────────
      const weeks = weekStarts.map((weekStart) => {
        const weekEnd = addDays(weekStart, 6); // Sunday

        const weekActivities = phaseActivities.filter((a) => {
          const date = a.start_date_local.slice(0, 10);
          return date >= weekStart && date <= weekEnd;
        });

        // 合計
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

        // 平均（当該フィールドを持つセッションのみ対象）
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

        // PMC スナップショット（週末 = 日曜日の値）
        // RSS 系: 日曜から遡って ctl が存在する wellness エントリを探す
        let rssEntry: Wellness | undefined;
        for (let d = weekEnd; d >= weekStart; d = addDays(d, -1)) {
          const w = wellnessByDate.get(d);
          if (w && w.ctl != null) {
            rssEntry = w;
            break;
          }
        }
        const rssCtl = round(rssEntry?.ctl ?? 0, 1);
        const rssAtl = round(rssEntry?.atl ?? 0, 1);

        // LBSS 系: 週末日付のエントリを直接参照（computeLbssPmc は全日付を持つ）
        const lbssEntry = lbssByDate.get(weekEnd);

        const pmc_end_of_week = {
          rss: {
            ctl: rssCtl,
            atl: rssAtl,
            tsb: round((rssCtl ?? 0) - (rssAtl ?? 0), 1),
          },
          lbss: {
            ctl: round(lbssEntry?.ctl ?? 0, 1),
            atl: round(lbssEntry?.atl ?? 0, 1),
            tsb: round(lbssEntry?.tsb ?? 0, 1),
          },
        };

        return {
          week_start: weekStart,
          totals,
          session_count: weekActivities.length,
          averages,
          pmc_end_of_week,
        };
      });

      // ── フェーズ合計 ─────────────────────────────────────────────────────────
      const phase_totals = {
        rss: round(
          phaseActivities.reduce((s, a) => s + (a.icu_training_load ?? 0), 0),
          1,
        ),
        lbss: round(
          phaseActivities.reduce((s, a) => s + (a.StrydLBSSmod ?? 0), 0),
          1,
        ),
        time_min: Math.round(
          phaseActivities.reduce((s, a) => s + a.moving_time, 0) / 60,
        ),
        distance_km: round(
          phaseActivities.reduce((s, a) => s + a.distance, 0) / 1000,
          1,
        ),
        session_count: phaseActivities.length,
      };

      // ── トレンド ─────────────────────────────────────────────────────────────
      const rss_weekly = weeks.map((w) => w.totals.rss ?? 0);
      const lbss_weekly = weeks.map((w) => w.totals.lbss ?? 0);
      const rss_ctl_series = weeks.map((w) => w.pmc_end_of_week.rss.ctl ?? 0);
      const lbss_ctl_series = weeks.map((w) => w.pmc_end_of_week.lbss.ctl ?? 0);

      const totalWeeks = weeks.length;
      // ramp_rate = (最終週CTL - 初週CTL) / (週数 - 1)
      let rss_ramp_rate: number | null = null;
      let lbss_ramp_rate: number | null = null;
      if (totalWeeks >= 2) {
        rss_ramp_rate = round(
          (rss_ctl_series[totalWeeks - 1] - rss_ctl_series[0]) / (totalWeeks - 1),
          2,
        );
        lbss_ramp_rate = round(
          (lbss_ctl_series[totalWeeks - 1] - lbss_ctl_series[0]) / (totalWeeks - 1),
          2,
        );
      }

      const result = {
        phase_name: phaseName ?? null,
        start_date: startDate,
        end_date: endDate,
        total_weeks: totalWeeks,
        phase_totals,
        weeks,
        trends: {
          rss_weekly,
          lbss_weekly,
          rss_ctl_series,
          lbss_ctl_series,
          rss_ramp_rate,
          lbss_ramp_rate,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
