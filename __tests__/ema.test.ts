// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { emaStep, computeEma } from "../src/utils/ema.js";

// ─── emaStep ──────────────────────────────────────────────────────────────────

describe("emaStep", () => {
  it("初期値 0 から値を入力すると value/tau になる", () => {
    // 0 * (6/7) + 70 * (1/7) = 10
    expect(emaStep(0, 70, 7)).toBeCloseTo(10);
  });

  it("値 0 を入力すると decay だけ減衰する", () => {
    // 10 * (6/7) + 0 = 60/7 ≈ 8.5714
    expect(emaStep(10, 0, 7)).toBeCloseTo(60 / 7);
  });

  it("prev == value のとき定常状態（EMA 変化なし）", () => {
    // 10 * (6/7) + 10 * (1/7) = 10
    expect(emaStep(10, 10, 7)).toBeCloseTo(10);
  });

  it("tau=1 のとき前日の値を完全に上書きする", () => {
    expect(emaStep(9999, 50, 1)).toBeCloseTo(50);
  });

  it("tau=2 のとき prev と value の単純平均になる", () => {
    // 100 * 0.5 + 50 * 0.5 = 75
    expect(emaStep(100, 50, 2)).toBeCloseTo(75);
  });
});

// ─── computeEma ───────────────────────────────────────────────────────────────

describe("computeEma", () => {
  it("空エントリでは全日付が 0 になる", () => {
    const result = computeEma([], 7, "2024-01-01", "2024-01-03");
    expect(result.get("2024-01-01")).toBeCloseTo(0);
    expect(result.get("2024-01-02")).toBeCloseTo(0);
    expect(result.get("2024-01-03")).toBeCloseTo(0);
  });

  it("startDate〜endDate の全日付をキーに持つ", () => {
    const result = computeEma([], 7, "2024-01-01", "2024-01-05");
    expect(result.size).toBe(5);
    expect(result.has("2024-01-01")).toBe(true);
    expect(result.has("2024-01-05")).toBe(true);
  });

  it("最初の日に値がある場合の EMA を正確に計算する", () => {
    // Day1: 0*(6/7) + 70*(1/7) = 10
    // Day2: 10*(6/7) + 0        = 60/7
    // Day3: (60/7)*(6/7) + 0   = 360/49
    const result = computeEma(
      [{ date: "2024-01-01", value: 70 }],
      7,
      "2024-01-01",
      "2024-01-03",
    );
    expect(result.get("2024-01-01")).toBeCloseTo(10);
    expect(result.get("2024-01-02")).toBeCloseTo(60 / 7);
    expect(result.get("2024-01-03")).toBeCloseTo(360 / 49);
  });

  it("同日に複数エントリがある場合は日合算してから EMA に入力する", () => {
    // 30 + 40 = 70 として計算 → emaStep(0, 70, 7) = 10
    const result = computeEma(
      [
        { date: "2024-01-01", value: 30 },
        { date: "2024-01-01", value: 40 },
      ],
      7,
      "2024-01-01",
      "2024-01-01",
    );
    expect(result.get("2024-01-01")).toBeCloseTo(10);
  });

  it("同日合算と個別入力は結果が異なる（合算の必要性を確認）", () => {
    // 合算: emaStep(0, 70, 7) = 10
    const summed = computeEma(
      [
        { date: "2024-01-01", value: 30 },
        { date: "2024-01-01", value: 40 },
      ],
      7,
      "2024-01-01",
      "2024-01-01",
    );
    // 個別に 2 日に分けた場合（参照用）
    const split = computeEma(
      [
        { date: "2024-01-01", value: 30 },
        { date: "2024-01-02", value: 40 },
      ],
      7,
      "2024-01-01",
      "2024-01-02",
    );
    expect(summed.get("2024-01-01")).toBeCloseTo(10);
    // 2 日に分けた場合の 2 日目: (30/7)*(6/7) + 40*(1/7) ≠ 10
    expect(split.get("2024-01-02")).not.toBeCloseTo(10);
  });

  it("range 外のエントリは無視される", () => {
    // 2023-12-31 の値は計算範囲外
    const result = computeEma(
      [{ date: "2023-12-31", value: 9999 }],
      7,
      "2024-01-01",
      "2024-01-02",
    );
    expect(result.get("2024-01-01")).toBeCloseTo(0);
    expect(result.get("2024-01-02")).toBeCloseTo(0);
  });

  it("initial を指定すると計算前の初期値として使われる", () => {
    // initial=42, tau=42, value=0
    // Day1: 42*(41/42) + 0*(1/42) = 42 - 1 = 41
    const result = computeEma([], 42, "2024-01-01", "2024-01-01", 42);
    expect(result.get("2024-01-01")).toBeCloseTo(41);
  });

  it("tau=42（CTL相当）で 1 日分の負荷を入力した場合", () => {
    // emaStep(0, 42, 42) = 42/42 = 1
    const result = computeEma(
      [{ date: "2024-01-01", value: 42 }],
      42,
      "2024-01-01",
      "2024-01-01",
    );
    expect(result.get("2024-01-01")).toBeCloseTo(1);
  });

  it("startDate == endDate のとき 1 件のみ返す", () => {
    const result = computeEma([], 7, "2024-06-15", "2024-06-15");
    expect(result.size).toBe(1);
    expect(result.has("2024-06-15")).toBe(true);
  });
});
