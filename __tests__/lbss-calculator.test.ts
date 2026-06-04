// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  computeLbssPmc,
  getLbssPmcAt,
} from "../src/extensions/stryd/lbss-calculator.js";
import type { Activity } from "../src/core/types.js";

// ─── テスト用ファクトリ ──────────────────────────────────────────────────────

function makeActivity(date: string, lbss?: number): Activity {
  return {
    id: `act_${date}`,
    name: "Morning Run",
    type: "Run",
    start_date_local: `${date}T10:00:00`,
    moving_time: 3600,
    distance: 10000,
    ...(lbss !== undefined ? { StrydLBSSmod: lbss } : {}),
  };
}

// ─── computeLbssPmc ──────────────────────────────────────────────────────────

describe("computeLbssPmc", () => {
  it("結果の長さが日付範囲に一致する", () => {
    const result = computeLbssPmc([], "2024-01-01", "2024-01-05");
    expect(result).toHaveLength(5);
    expect(result[0].date).toBe("2024-01-01");
    expect(result[4].date).toBe("2024-01-05");
  });

  it("アクティビティがない場合は CTL/ATL/TSB が全て 0", () => {
    const result = computeLbssPmc([], "2024-01-01", "2024-01-03");
    for (const entry of result) {
      expect(entry.ctl).toBe(0);
      expect(entry.atl).toBe(0);
      expect(entry.tsb).toBe(0);
    }
  });

  it("単一アクティビティの CTL/ATL/TSB を正確に計算する", () => {
    // LBSS=70, τ_atl=7 → ATL = 0*(6/7) + 70*(1/7) = 10
    // LBSS=70, τ_ctl=42 → CTL = 0*(41/42) + 70*(1/42) = 70/42 = 5/3
    const result = computeLbssPmc(
      [makeActivity("2024-01-01", 70)],
      "2024-01-01",
      "2024-01-01",
    );
    expect(result).toHaveLength(1);
    expect(result[0].atl).toBeCloseTo(10);
    expect(result[0].ctl).toBeCloseTo(70 / 42);
    expect(result[0].tsb).toBeCloseTo(70 / 42 - 10);
  });

  it("TSB は常に CTL - ATL に等しい", () => {
    const activities = [
      makeActivity("2024-01-01", 70),
      makeActivity("2024-01-03", 50),
      makeActivity("2024-01-05", 90),
    ];
    const result = computeLbssPmc(activities, "2024-01-01", "2024-01-07");
    for (const entry of result) {
      expect(entry.tsb).toBeCloseTo(entry.ctl - entry.atl);
    }
  });

  it("アクティビティ翌日の ATL は decay だけ減衰する", () => {
    // Day1 ATL=10, Day2 (休息): ATL = 10*(6/7) = 60/7
    const result = computeLbssPmc(
      [makeActivity("2024-01-01", 70)],
      "2024-01-01",
      "2024-01-02",
    );
    expect(result[0].atl).toBeCloseTo(10);
    expect(result[1].atl).toBeCloseTo(60 / 7);
  });

  it("CTL は ATL より緩やかに上昇・減衰する", () => {
    // τ_ctl=42 > τ_atl=7 → CTL の変化は ATL より小さい
    const activities = [makeActivity("2024-01-01", 70)];
    const result = computeLbssPmc(activities, "2024-01-01", "2024-01-08");
    const day1 = result[0];
    const day8 = result[7]; // 1週間後
    // 1週間後の ATL の減衰率 = (6/7)^7 ≈ 0.3493
    // 1週間後の CTL の減衰率 = (41/42)^7 ≈ 0.8465
    expect(day8.atl / day1.atl).toBeCloseTo((6 / 7) ** 7, 3);
    expect(day8.ctl / day1.ctl).toBeCloseTo((41 / 42) ** 7, 3);
  });

  it("StrydLBSSmod を持たないアクティビティは無視される", () => {
    const activities = [
      makeActivity("2024-01-01"),         // StrydLBSSmod なし
      makeActivity("2024-01-02"),         // StrydLBSSmod なし
    ];
    const result = computeLbssPmc(activities, "2024-01-01", "2024-01-02");
    for (const entry of result) {
      expect(entry.ctl).toBe(0);
      expect(entry.atl).toBe(0);
    }
  });

  it("同日複数アクティビティの LBSS は日合算される", () => {
    // 30 + 40 = 70 として計算 → ATL = 10
    const activities = [
      makeActivity("2024-01-01", 30),
      makeActivity("2024-01-01", 40),
    ];
    const result = computeLbssPmc(activities, "2024-01-01", "2024-01-01");
    expect(result[0].atl).toBeCloseTo(10);
    // 合算せず順番に適用した場合 ATL ≠ 10（合算の必要性の確認）
    // emaStep(emaStep(0, 30, 7), 40, 7) = (30/7)*(6/7) + 40/7 ≠ 10
    const withoutSum =
      (30 / 7) * (6 / 7) + 40 / 7;
    expect(result[0].atl).not.toBeCloseTo(withoutSum);
  });

  it("LBSS=0 のアクティビティは休息日と同じ扱いになる", () => {
    const withZeroLbss = computeLbssPmc(
      [makeActivity("2024-01-01", 0)],
      "2024-01-01",
      "2024-01-01",
    );
    const noActivity = computeLbssPmc([], "2024-01-01", "2024-01-01");
    expect(withZeroLbss[0].atl).toBeCloseTo(noActivity[0].atl);
  });

  it("連続する高負荷日で CTL と ATL が蓄積される", () => {
    // 毎日 LBSS=70 を 3 日間
    // ATL day1 = 10
    // ATL day2 = 10*(6/7) + 10 = 130/7 ≈ 18.571
    // ATL day3 = (130/7)*(6/7) + 10 = 780/49 + 490/49 = 1270/49 ≈ 25.918
    const activities = [
      makeActivity("2024-01-01", 70),
      makeActivity("2024-01-02", 70),
      makeActivity("2024-01-03", 70),
    ];
    const result = computeLbssPmc(activities, "2024-01-01", "2024-01-03");
    expect(result[0].atl).toBeCloseTo(10);
    expect(result[1].atl).toBeCloseTo(130 / 7);
    expect(result[2].atl).toBeCloseTo(1270 / 49);
  });

  it("日付が昇順で返される", () => {
    const result = computeLbssPmc([], "2024-01-01", "2024-01-03");
    expect(result[0].date).toBe("2024-01-01");
    expect(result[1].date).toBe("2024-01-02");
    expect(result[2].date).toBe("2024-01-03");
  });

  it("startDate == endDate のとき 1 件のみ返す", () => {
    const result = computeLbssPmc(
      [makeActivity("2024-06-15", 100)],
      "2024-06-15",
      "2024-06-15",
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2024-06-15");
  });
});

// ─── getLbssPmcAt ────────────────────────────────────────────────────────────

describe("getLbssPmcAt", () => {
  it("アクティビティがない場合は CTL=ATL=TSB=0 を返す", () => {
    const result = getLbssPmcAt([], "2024-01-10");
    expect(result).toEqual({ date: "2024-01-10", ctl: 0, atl: 0, tsb: 0 });
  });

  it("全アクティビティが targetDate より後の場合は 0 を返す", () => {
    const activities = [makeActivity("2024-02-01", 70)];
    const result = getLbssPmcAt(activities, "2024-01-15");
    expect(result).toEqual({ date: "2024-01-15", ctl: 0, atl: 0, tsb: 0 });
  });

  it("targetDate の PMC 値を返す", () => {
    // "2024-01-01" に LBSS=70 → "2024-01-01" の ATL = 10
    const activities = [makeActivity("2024-01-01", 70)];
    const result = getLbssPmcAt(activities, "2024-01-01");
    expect(result.date).toBe("2024-01-01");
    expect(result.atl).toBeCloseTo(10);
    expect(result.ctl).toBeCloseTo(70 / 42);
  });

  it("targetDate が最終アクティビティより後でも正しく計算する", () => {
    // Day1: ATL=10, Day5 (何もなし): ATL = 10 * (6/7)^4
    const activities = [makeActivity("2024-01-01", 70)];
    const result = getLbssPmcAt(activities, "2024-01-05");
    expect(result.date).toBe("2024-01-05");
    expect(result.atl).toBeCloseTo(10 * (6 / 7) ** 4);
  });

  it("最古のアクティビティ日を startDate として使用する", () => {
    // activities を渡す順序に依存しないことを確認
    const activities = [
      makeActivity("2024-01-03", 70),
      makeActivity("2024-01-01", 70), // 最古（順序が後でも）
      makeActivity("2024-01-02", 70),
    ];
    const result = getLbssPmcAt(activities, "2024-01-03");
    // 3日分の蓄積があるはず
    const fromSeries = computeLbssPmc(activities, "2024-01-01", "2024-01-03");
    expect(result.atl).toBeCloseTo(fromSeries.at(-1)!.atl);
  });
});
