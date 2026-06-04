// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * EMA (Exponential Moving Average) utility
 *
 * PMC (Performance Management Chart) での用途:
 *   CTL (Chronic Training Load):  τ = 42 日
 *   ATL (Acute Training Load):    τ = 7  日
 *
 * 漸化式: EMA(t) = EMA(t-1) × (1 - 1/τ) + value(t) × (1/τ)
 */

export interface DailyEntry {
  date: string;  // YYYY-MM-DD
  value: number;
}

/**
 * 1ステップ分の EMA を計算する (pure)。
 *
 * @param prev  - 前日の EMA 値
 * @param value - 当日の負荷値
 * @param tau   - 時定数（日数）
 */
export function emaStep(prev: number, value: number, tau: number): number {
  return prev * (1 - 1 / tau) + value * (1 / tau);
}

/**
 * 指定期間の EMA 系列を計算する (pure function)。
 *
 * - 同日に複数エントリがある場合は日合算してから EMA に入力する
 * - entries に存在しない日は value=0 として扱う（休息日）
 * - 初期値はデフォルト 0（CTL/ATL の慣例）
 *
 * @param entries   - 日付-値ペアの配列（同日複数可）
 * @param tau       - 時定数（日数）: CTL=42、ATL=7
 * @param startDate - 計算開始日 (YYYY-MM-DD, inclusive)
 * @param endDate   - 計算終了日 (YYYY-MM-DD, inclusive)
 * @param initial   - 初期 EMA 値（デフォルト: 0）
 * @returns 日付 → EMA 値のマップ（startDate〜endDate の全日付を含む）
 */
export function computeEma(
  entries: ReadonlyArray<DailyEntry>,
  tau: number,
  startDate: string,
  endDate: string,
  initial = 0,
): Map<string, number> {
  // 同日複数の値を合算
  const daily = new Map<string, number>();
  for (const { date, value } of entries) {
    daily.set(date, (daily.get(date) ?? 0) + value);
  }

  // startDate から endDate まで 1 日ずつ EMA を更新
  const result = new Map<string, number>();
  let ema = initial;
  const end = new Date(endDate + "T00:00:00Z");
  const current = new Date(startDate + "T00:00:00Z");
  while (current <= end) {
    const date = current.toISOString().slice(0, 10);
    ema = emaStep(ema, daily.get(date) ?? 0, tau);
    result.set(date, ema);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}
