// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCPツール: get_current_pmc
 *
 * 今日時点の PMC (Performance Management Chart) 値を返す。
 *
 * - RSS 系: Intervals.icu が wellness に保存済みの ctl/atl/tsb を使用
 * - LBSS 系: StrydLBSSmod から WARMUP_DAYS の助走期間を含めて EMA 計算
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config_ } from "../../../config.js";
import { intervalsClient } from "../../../core/intervals-client.js";
import type { Activity, Wellness } from "../../../core/types.js";
import { today, addDays } from "../../../utils/date.js";
import { computeLbssPmc } from "../lbss-calculator.js";

/**
 * EMA の精度確保のための助走期間（日数）。
 * τ_CTL=42 の約 4.3倍 → cold-start バイアス < 1%。
 */
const WARMUP_DAYS = 180;

export function registerGetCurrentPmc(server: McpServer): void {
  server.registerTool(
    "get_current_pmc",
    {
      title: "Get Current PMC",
      description:
        "Get today's Performance Management Chart (PMC) values. " +
        "Returns CTL, ATL, and TSB for two load metrics:\n" +
        "- rss: RSS-based (from Intervals.icu wellness data, pre-calculated)\n" +
        "- lbss: LBSS-based (calculated from Stryd StrydLBSSmod over the past 180 days)\n" +
        "Note: lbss values are 0 if no Stryd data is available in the period.",
      inputSchema: {},
    },
    async () => {
      const endDate = today(config_.timezone);
      const startDate = addDays(endDate, -WARMUP_DAYS);

      // wellness と activities を並列取得
      const [rawWellness, rawActivities] = await Promise.all([
        intervalsClient.getWellness(startDate, endDate),
        intervalsClient.getActivities(startDate, endDate),
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
      const lbssSeries = computeLbssPmc(activities, startDate, endDate);
      const lbssToday = lbssSeries.at(-1);
      const lbss = {
        ctl: Math.round((lbssToday?.ctl ?? 0) * 10) / 10,
        atl: Math.round((lbssToday?.atl ?? 0) * 10) / 10,
        tsb: Math.round((lbssToday?.tsb ?? 0) * 10) / 10,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ date: endDate, rss, lbss }, null, 2),
          },
        ],
      };
    },
  );
}
