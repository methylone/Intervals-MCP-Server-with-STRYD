// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 日付ユーティリティ。
 *
 * civil date (YYYY-MM-DD) の算術は UTC アンカーで行い、timezone は
 * instant (Date) を athlete の現地日付へ変換するときだけ使う。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * YYYY-MM-DD 文字列を UTC 深夜0時の Date に変換する。
 * civil date 算術のための timezone 非依存なシード。
 */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00.000Z");
}

/**
 * Date オブジェクトを指定 timezone の YYYY-MM-DD 形式の文字列に変換する。
 */
export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/**
 * 指定 timezone で「今日」の日付を返す (YYYY-MM-DD)。
 */
export function today(timeZone: string): string {
  return formatDate(new Date(), timeZone);
}

/**
 * 日付文字列に n 日を加算した日付を返す (pure)。n が負なら過去方向。
 */
export function addDays(dateStr: string, n: number): string {
  return new Date(parseDate(dateStr).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * startDate から endDate までの全日付を含む配列を返す (inclusive, YYYY-MM-DD)。
 * startDate > endDate の場合は空配列。
 */
export function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const end = parseDate(endDate);
  const current = parseDate(startDate);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setTime(current.getTime() + DAY_MS);
  }
  return dates;
}

/**
 * 指定日が属する週の月曜日 (ISO 週: Mon-Sun) を返す (YYYY-MM-DD)。
 *
 * 例:
 *   "2024-01-15"（月）→ "2024-01-15"
 *   "2024-01-17"（水）→ "2024-01-15"
 *   "2024-01-21"（日）→ "2024-01-15"
 */
export function toWeekStart(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // 0=Sun→6, 1=Mon→0, 2=Tue→1, ..., 6=Sat→5
  const daysFromMonday = (utcDay + 6) % 7;
  return addDays(dateStr, -daysFromMonday);
}
