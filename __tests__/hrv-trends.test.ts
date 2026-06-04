// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { computeHrvTrends } from "../src/utils/hrv-trends.js";
import type { Wellness } from "../src/core/types.js";

/** テスト用ヘルパー: 最低限の Wellness オブジェクトを作成 */
function makeWellness(
  date: string,
  hrv?: number,
  restingHR?: number,
): Wellness {
  return { id: date, hrv, restingHR } as Wellness;
}

describe("computeHrvTrends", () => {
  it("7日間すべて有効なデータ → mean, sd, cv が正しく計算される", () => {
    const wellness = [
      makeWellness("2026-03-01", 50, 52),
      makeWellness("2026-03-02", 52, 51),
      makeWellness("2026-03-03", 48, 53),
      makeWellness("2026-03-04", 54, 50),
      makeWellness("2026-03-05", 46, 54),
      makeWellness("2026-03-06", 56, 49),
      makeWellness("2026-03-07", 44, 52),
    ];
    const result = computeHrvTrends(wellness, "2026-03-07", "2026-03-07", 7);
    expect(result).toHaveLength(1);
    const p = result[0];
    expect(p.date).toBe("2026-03-07");
    expect(p.valid_days).toBe(7);
    expect(p.hrv_mean).toBe(50.0);
    // SD = sqrt(((0+4+4+16+16+36+36)/7)) = sqrt(112/7) = sqrt(16) = 4.0
    expect(p.hrv_sd).toBe(4.0);
    // CV = 4.0 / 50.0 * 100 = 8.0
    expect(p.hrv_cv).toBe(8.0);
    expect(p.rhr_mean).toBeCloseTo(51.6, 1);
  });

  it("欠損あり（4/7 有効）→ threshold を超えているので計算される", () => {
    const wellness = [
      makeWellness("2026-03-01", 60, 50),
      makeWellness("2026-03-02", undefined, undefined),
      makeWellness("2026-03-03", 62, 48),
      makeWellness("2026-03-04", undefined, undefined),
      makeWellness("2026-03-05", 58, 52),
      makeWellness("2026-03-06", undefined, undefined),
      makeWellness("2026-03-07", 64, 49),
    ];
    const result = computeHrvTrends(wellness, "2026-03-07", "2026-03-07", 7);
    expect(result[0].valid_days).toBe(4);
    expect(result[0].hrv_mean).not.toBeNull();
    expect(result[0].hrv_cv).not.toBeNull();
  });

  it("欠損あり（2/7 有効）→ threshold 未達で null", () => {
    const wellness = [
      makeWellness("2026-03-01", 60, 50),
      makeWellness("2026-03-07", 64, 49),
    ];
    const result = computeHrvTrends(wellness, "2026-03-07", "2026-03-07", 7);
    expect(result[0].valid_days).toBe(2);
    expect(result[0].hrv_mean).toBeNull();
    expect(result[0].hrv_sd).toBeNull();
    expect(result[0].hrv_cv).toBeNull();
    expect(result[0].rhr_mean).toBeNull();
  });

  it("全日同値 → sd=0, cv=0（完全安定）", () => {
    const wellness = Array.from({ length: 7 }, (_, i) =>
      makeWellness(`2026-03-0${i + 1}`, 55, 50),
    );
    const result = computeHrvTrends(wellness, "2026-03-07", "2026-03-07", 7);
    expect(result[0].hrv_sd).toBe(0);
    expect(result[0].hrv_cv).toBe(0);
  });

  it("複数日出力 → 各日が正しい window を使用", () => {
    const wellness = [
      makeWellness("2026-03-01", 50, 50),
      makeWellness("2026-03-02", 60, 48),
      makeWellness("2026-03-03", 70, 46),
      makeWellness("2026-03-04", 80, 44),
    ];
    const result = computeHrvTrends(wellness, "2026-03-03", "2026-03-04", 3);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2026-03-03");
    expect(result[0].hrv_mean).toBe(60.0);
    expect(result[1].date).toBe("2026-03-04");
    expect(result[1].hrv_mean).toBe(70.0);
  });

  it("wellness 配列が空 → valid_days=0, 全 null", () => {
    const result = computeHrvTrends([], "2026-03-07", "2026-03-07", 7);
    expect(result).toHaveLength(1);
    expect(result[0].valid_days).toBe(0);
    expect(result[0].hrv_mean).toBeNull();
  });

  it("hrv があるが restingHR がない日 → hrv は計算, rhr は存在する日のみ", () => {
    const wellness = [
      makeWellness("2026-03-01", 50, undefined),
      makeWellness("2026-03-02", 52, undefined),
      makeWellness("2026-03-03", 48, 50),
    ];
    const result = computeHrvTrends(wellness, "2026-03-03", "2026-03-03", 3);
    expect(result[0].valid_days).toBe(3);
    expect(result[0].hrv_mean).not.toBeNull();
    expect(result[0].rhr_mean).toBe(50.0);
  });
});
