// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * LBSS ベース PMC (Performance Management Chart) 計算
 *
 * Intervals.icu が RSS ベースの CTL/ATL を提供するのに対し、
 * LBSS ベースは提供されないため自前で計算する。
 *
 * 漸化式:
 *   CTL_LBSS(t) = CTL_LBSS(t-1) × (1 - 1/42) + LBSS(t) × (1/42)
 *   ATL_LBSS(t) = ATL_LBSS(t-1) × (1 - 1/7)  + LBSS(t) × (1/7)
 *   TSB_LBSS(t) = CTL_LBSS(t) - ATL_LBSS(t)
 *
 * データソース: 呼び出し側が指定する LBSS カスタムフィールド（既定 StrydLBSSv2）。
 * 注意: Stryd フィールドは 2025 年 11 月以降のデータにのみ存在する。
 */

import type { Activity } from "../../core/types.js";
import { computeEma, type DailyEntry } from "../../utils/ema.js";
import { dateRange } from "../../utils/date.js";
import { readNumericField } from "../../utils/field-access.js";

/** CTL の時定数（日数） */
const CTL_TAU = 42;
/** ATL の時定数（日数） */
const ATL_TAU = 7;

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** 特定日の LBSS ベース PMC 値 */
export interface LbssPmcEntry {
  /** YYYY-MM-DD */
  date: string;
  /** Chronic Training Load (τ=42日) */
  ctl: number;
  /** Acute Training Load (τ=7日) */
  atl: number;
  /** Training Stress Balance = CTL - ATL */
  tsb: number;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * アクティビティ配列から LBSS ベース PMC 系列を計算する (pure function)。
 *
 * - 指定フィールドを持たないアクティビティの LBSS は 0 として扱う
 * - 同日複数アクティビティの LBSS は日合算してから EMA に入力する
 * - startDate より前のアクティビティが多いほど CTL/ATL の精度が上がる
 *   （推奨: targetDate の 6 ヶ月以上前を startDate にして助走期間を確保）
 *
 * @param activities - Intervals.icu アクティビティ配列
 * @param startDate  - 計算開始日 (YYYY-MM-DD, inclusive)
 * @param endDate    - 計算終了日 (YYYY-MM-DD, inclusive)
 * @param field      - LBSS を読み取るカスタムフィールド名（呼び出し側が解決して渡す。
 *                     pure 維持のため内部で config を読まない）
 * @returns 日別 PMC エントリの配列（startDate〜endDate の全日付、昇順）
 */
export function computeLbssPmc(
  activities: ReadonlyArray<Activity>,
  startDate: string,
  endDate: string,
  field: string,
): LbssPmcEntry[] {
  // 指定フィールドを持つアクティビティのみ DailyEntry として抽出
  // date は start_date_local の先頭 10 文字 (YYYY-MM-DD) で取得
  const entries: DailyEntry[] = [];
  for (const activity of activities) {
    const value = readNumericField(activity, field);
    if (value !== null) {
      entries.push({
        date: activity.start_date_local.slice(0, 10),
        value,
      });
    }
  }

  // CTL (τ=42) と ATL (τ=7) をそれぞれ計算
  const ctlMap = computeEma(entries, CTL_TAU, startDate, endDate);
  const atlMap = computeEma(entries, ATL_TAU, startDate, endDate);

  // Map → 昇順配列に変換（dateRange が正規化された YYYY-MM-DD を生成）
  return dateRange(startDate, endDate).map((date) => {
    const ctl = ctlMap.get(date) ?? 0;
    const atl = atlMap.get(date) ?? 0;
    return { date, ctl, atl, tsb: ctl - atl };
  });
}

/**
 * 特定日の LBSS ベース PMC 値を返す (pure function)。
 *
 * activities に含まれる最古のアクティビティ日を startDate として
 * `computeLbssPmc` を呼び出す。
 * アクティビティがない、または全て targetDate より後の場合は
 * CTL=ATL=TSB=0 を返す。
 *
 * @param activities - Intervals.icu アクティビティ配列（targetDate まで含む）
 * @param targetDate - 取得したい日付 (YYYY-MM-DD)
 * @param field      - LBSS を読み取るカスタムフィールド名（呼び出し側が解決して渡す）
 */
export function getLbssPmcAt(
  activities: ReadonlyArray<Activity>,
  targetDate: string,
  field: string,
): LbssPmcEntry {
  const zero: LbssPmcEntry = { date: targetDate, ctl: 0, atl: 0, tsb: 0 };

  // 最古のアクティビティ日付を startDate として使用
  const firstDate = activities
    .map((a) => a.start_date_local.slice(0, 10))
    .sort()[0];

  if (!firstDate || firstDate > targetDate) {
    return zero;
  }

  const series = computeLbssPmc(activities, firstDate, targetDate, field);
  return series.at(-1) ?? zero;
}
