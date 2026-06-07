// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCPツール: get_current_pmc
 *
 * 今日時点の PMC (Performance Management Chart) 値を返す。
 *
 * - RSS 系: Intervals.icu が wellness に保存済みの ctl/atl/tsb を使用
 * - LBSS 系: StrydLBSSmod から WARMUP_DAYS の助走期間を含めて EMA 計算
 */

import { z } from "zod";
import { config_, FIELD_NAME_REGEX } from "../../../config.js";
import { intervalsClient } from "../../../core/intervals-client.js";
import type { Activity, Wellness } from "../../../core/types.js";
import { today, addDays } from "../../../utils/date.js";
import { computeLbssPmc } from "../lbss-calculator.js";
import type { ToolDef, ToolContext } from "../../../tool-registry.js";

/**
 * EMA の精度確保のための助走期間（日数）。
 * τ_CTL=42 の約 4.3倍 → cold-start バイアス < 1%。
 */
const WARMUP_DAYS = 180;

export const getCurrentPmcTool: ToolDef = {
  name: "get_current_pmc",
  title: "Get Current PMC",
  description:
    "Get today's Performance Management Chart (PMC) values. " +
    "Returns CTL, ATL, and TSB for two load metrics:\n" +
    "- rss: RSS-based (from Intervals.icu wellness data, pre-calculated)\n" +
    "- lbss: LBSS-based (computed server-side via EMA over the past 180 days from the " +
    "configured LBSS field — env LBSS_FIELD, default StrydLBSSv2; override per-call with lbss_field)\n" +
    "Set include_legacy=true to also return lbss_legacy from the legacy field (env LBSS_FIELD_LEGACY).\n" +
    "Note: lbss values are 0 if no Stryd data is available in the period.",
  schema: {
    lbss_field: z
      .string()
      .regex(FIELD_NAME_REGEX)
      .optional()
      .describe(
        'Override the LBSS custom-field name for this call ' +
        '(e.g. "StrydLBSSv2", "StrydLBSSmod"). Defaults to env LBSS_FIELD.',
      ),
    include_legacy: z
      .boolean()
      .optional()
      .describe(
        "When true, also return lbss_legacy (CTL/ATL/TSB) from the legacy LBSS " +
        "field (env LBSS_FIELD_LEGACY) for new-vs-old comparison.",
      ),
  },
  handler: async (
    { lbss_field, include_legacy }: { lbss_field?: string; include_legacy?: boolean },
    ctx?: ToolContext,
  ) => {
    const lbssField = lbss_field ?? config_.lbssField;
    const withLegacy = include_legacy ?? false;
    const endDate = today(config_.timezone);
      const startDate = addDays(endDate, -WARMUP_DAYS);

      // wellness と activities を並列取得
      const [rawWellness, rawActivities] = await Promise.all([
        intervalsClient.getWellness(startDate, endDate, { signal: ctx?.signal }),
        intervalsClient.getActivities(startDate, endDate, { signal: ctx?.signal }),
      ]);

      const wellness = rawWellness as Wellness[];
      const activities = rawActivities as Activity[];

      // RSS 系: wellness の最新エントリを使用。
      // 当日 wellness がまだ記録されていない場合は直近の日付を使う。
      const latestRss = [...wellness].reverse().find((w) => w.ctl != null);
      const rssCtl = Math.round((latestRss?.ctl ?? 0) * 10) / 10;
      const rssAtl = Math.round((latestRss?.atl ?? 0) * 10) / 10;
      const rss = {
        ctl: rssCtl,
        atl: rssAtl,
        // Intervals の tsb フィールドは使わず CTL - ATL で統一
        tsb: Math.round((rssCtl - rssAtl) * 10) / 10,
        /** どの日付の wellness 値を使ったか（今日分がない場合に役立つ） */
        as_of: latestRss?.id ?? null,
      };

      // LBSS 系: startDate から endDate まで EMA で計算（助走期間含む）
      const lbssToday = computeLbssPmc(activities, startDate, endDate, lbssField).at(-1);
      const lbss = {
        ctl: Math.round((lbssToday?.ctl ?? 0) * 10) / 10,
        atl: Math.round((lbssToday?.atl ?? 0) * 10) / 10,
        tsb: Math.round((lbssToday?.tsb ?? 0) * 10) / 10,
      };

      let lbssLegacy: { ctl: number; atl: number; tsb: number } | undefined;
      if (withLegacy) {
        const legacyToday = computeLbssPmc(activities, startDate, endDate, config_.lbssFieldLegacy).at(-1);
        lbssLegacy = {
          ctl: Math.round((legacyToday?.ctl ?? 0) * 10) / 10,
          atl: Math.round((legacyToday?.atl ?? 0) * 10) / 10,
          tsb: Math.round((legacyToday?.tsb ?? 0) * 10) / 10,
        };
      }

    return { date: endDate, rss, lbss, ...(withLegacy ? { lbss_legacy: lbssLegacy } : {}) };
  },
};
