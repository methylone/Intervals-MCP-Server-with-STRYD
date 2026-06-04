// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  computeDietFields,
  computeWorkoutIntake,
  computeNutritionDerived,
  CHO_KCAL_PER_GRAM,
} from "../src/utils/nutrition.js";
import type { Activity, Wellness } from "../src/core/types.js";

// ─── Factories ────────────────────────────────────────────────────────────────

type MealKey = "CalBreakfast" | "CalLunch" | "CalDinner" | "CalSnack1" | "CalSnack2";

function makeWellness(
  date: string,
  meals: Partial<Record<MealKey, number | null>>
): Wellness {
  return { id: date, ...meals };
}

function makeActivity(
  id: string,
  startDateLocal: string,
  cho?: number | null
): Activity {
  return {
    id,
    name: "test",
    type: "Run",
    start_date_local: startDateLocal,
    moving_time: 3600,
    distance: 10000,
    ...(cho !== undefined ? { carbs_ingested: cho } : {}),
  };
}

// ─── Test Vectors TV-01 〜 TV-10 ─────────────────────────────────────────────

describe("FR-NUTR-01 Test Vector Pack", () => {
  it("TV-01: 全 null、activity なし", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: null,
      CalLunch: null,
      CalDinner: null,
      CalSnack1: null,
      CalSnack2: null,
    });
    const result = computeNutritionDerived(w, []);
    expect(result.cal_diet_total).toBe(0);
    expect(result.cal_diet_main_meals_complete).toBe(false);
    expect(result.cal_diet_recorded_count).toBe(0);
    expect(result.cal_workout_intake).toBe(0);
    expect(result.cal_intake_total).toBe(0);
  });

  it("TV-02: 全 0 明示、activity なし", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 0,
      CalLunch: 0,
      CalDinner: 0,
      CalSnack1: 0,
      CalSnack2: 0,
    });
    const result = computeNutritionDerived(w, []);
    expect(result.cal_diet_total).toBe(0);
    expect(result.cal_diet_main_meals_complete).toBe(true);
    expect(result.cal_diet_recorded_count).toBe(5);
    expect(result.cal_workout_intake).toBe(0);
    expect(result.cal_intake_total).toBe(0);
  });

  it("TV-03: 主食のみ記録、snack は null", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 600,
      CalLunch: 800,
      CalDinner: 900,
      CalSnack1: null,
      CalSnack2: null,
    });
    const result = computeNutritionDerived(w, []);
    expect(result.cal_diet_total).toBe(2300);
    expect(result.cal_diet_main_meals_complete).toBe(true);
    expect(result.cal_diet_recorded_count).toBe(3);
    expect(result.cal_workout_intake).toBe(0);
    expect(result.cal_intake_total).toBe(2300);
  });

  it("TV-04: 主食 + activity (CHO あり)", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 600,
      CalLunch: 800,
      CalDinner: 900,
      CalSnack1: 200,
      CalSnack2: null,
    });
    const activities = [makeActivity("i1", "2026-05-01T07:00:00", 150)];
    const result = computeNutritionDerived(w, activities);
    expect(result.cal_diet_total).toBe(2500);
    expect(result.cal_diet_main_meals_complete).toBe(true);
    expect(result.cal_diet_recorded_count).toBe(4);
    expect(result.cal_workout_intake).toBeCloseTo(600.0, 5);
    expect(result.cal_intake_total).toBeCloseTo(3100.0, 5);
  });

  it("TV-05: Activity あり、carbohydrates が null", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 500,
      CalLunch: 700,
      CalDinner: 800,
      CalSnack1: null,
      CalSnack2: null,
    });
    const activities = [makeActivity("i1", "2026-05-01T07:00:00", null)];
    const result = computeNutritionDerived(w, activities);
    expect(result.cal_diet_total).toBe(2000);
    expect(result.cal_diet_main_meals_complete).toBe(true);
    expect(result.cal_diet_recorded_count).toBe(3);
    expect(result.cal_workout_intake).toBe(0);
    expect(result.cal_intake_total).toBe(2000);
  });

  it("TV-06: 複数 activity、CHO 有無混在", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 600,
      CalLunch: 800,
      CalDinner: 900,
      CalSnack1: null,
      CalSnack2: null,
    });
    const activities = [
      makeActivity("i1", "2026-05-01T07:00:00", 100),
      makeActivity("i2", "2026-05-01T18:00:00", null),
    ];
    const result = computeNutritionDerived(w, activities);
    expect(result.cal_workout_intake).toBeCloseTo(400.0, 5);
    expect(result.cal_intake_total).toBeCloseTo(2700.0, 5);
  });

  it("TV-07: Activity fetch failure (CRITICAL: activities=null → null)", () => {
    // This is the Critical Invariant expressed at the type/contract level.
    // HTTP mocking is unnecessary: the tool layer translates a thrown fetch
    // into a null argument to this function.
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 600,
      CalLunch: 800,
      CalDinner: 900,
      CalSnack1: null,
      CalSnack2: null,
    });
    const result = computeNutritionDerived(w, null);
    expect(result.cal_diet_total).toBe(2300);
    expect(result.cal_diet_main_meals_complete).toBe(true);
    expect(result.cal_diet_recorded_count).toBe(3);
    expect(result.cal_workout_intake).toBeNull();
    expect(result.cal_intake_total).toBeNull();

    // Also confirm the direct helper contract:
    expect(computeWorkoutIntake(null, "2026-05-01")).toBeNull();
  });

  it("TV-08: Midnight crossing — 開始日に全量計上、翌日は 0", () => {
    // start_date_local = 2026-05-01T23:00:00, duration 3h, CHO 50g
    const act = makeActivity("i1", "2026-05-01T23:00:00", 50);

    expect(computeWorkoutIntake([act], "2026-05-01")).toBeCloseTo(200.0, 5);
    expect(computeWorkoutIntake([act], "2026-05-02")).toBe(0);
  });

  it("TV-09: 早朝 activity", () => {
    const act = makeActivity("i1", "2026-05-02T04:00:00", 200);

    expect(computeWorkoutIntake([act], "2026-05-02")).toBeCloseTo(800.0, 5);
    expect(computeWorkoutIntake([act], "2026-05-01")).toBe(0);
  });

  it("TV-10: 0 と null の混在", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 500,
      CalLunch: 600,
      CalDinner: 0,
      CalSnack1: 200,
      CalSnack2: null,
    });
    const diet = computeDietFields(w);
    expect(diet.cal_diet_total).toBe(1300);
    expect(diet.cal_diet_main_meals_complete).toBe(true);
    expect(diet.cal_diet_recorded_count).toBe(4);
  });
});

// ─── Robustness edge cases ────────────────────────────────────────────────────

describe("computeWorkoutIntake edge cases", () => {
  it("空 activities 配列は 0 (null ではない)", () => {
    expect(computeWorkoutIntake([], "2026-05-01")).toBe(0);
  });

  it("start_date_local が undefined の activity は除外される", () => {
    const act = { ...makeActivity("i1", "", 100) };
    delete (act as Record<string, unknown>).start_date_local;
    expect(computeWorkoutIntake([act as Activity], "2026-05-01")).toBe(0);
  });

  it("start_date_local が空文字列の activity は除外される", () => {
    const act = makeActivity("i1", "", 100);
    expect(computeWorkoutIntake([act], "2026-05-01")).toBe(0);
  });

  it("start_date_local が 10 文字未満の activity は除外される", () => {
    const act = makeActivity("i1", "2026-05", 100);
    expect(computeWorkoutIntake([act], "2026-05-01")).toBe(0);
  });

  it("異日の activity は除外される", () => {
    const acts = [
      makeActivity("i1", "2026-04-30T22:00:00", 100),
      makeActivity("i2", "2026-05-01T07:00:00", 50),
      makeActivity("i3", "2026-05-02T05:00:00", 200),
    ];
    expect(computeWorkoutIntake(acts, "2026-05-01")).toBeCloseTo(200.0, 5);
  });

  it("小数 CHO (110.5g) → 442.0 (小数精度保持)", () => {
    const act = makeActivity("i1", "2026-05-01T07:00:00", 110.5);
    expect(computeWorkoutIntake([act], "2026-05-01")).toBeCloseTo(442.0, 5);
  });

  it("CHO が NaN や非数値 → 0 扱い", () => {
    const actNaN = makeActivity("i1", "2026-05-01T07:00:00", NaN);
    expect(computeWorkoutIntake([actNaN], "2026-05-01")).toBe(0);
  });
});

describe("computeDietFields edge cases", () => {
  it("主食 1 つだけ欠ける → main_meals_complete = false", () => {
    const w = makeWellness("2026-05-01", {
      CalBreakfast: 500,
      CalLunch: null,
      CalDinner: 700,
    });
    const diet = computeDietFields(w);
    expect(diet.cal_diet_main_meals_complete).toBe(false);
    expect(diet.cal_diet_recorded_count).toBe(2);
    expect(diet.cal_diet_total).toBe(1200);
  });

  it("snack のみ記録 → main_meals_complete = false", () => {
    const w = makeWellness("2026-05-01", {
      CalSnack1: 200,
      CalSnack2: 150,
    });
    const diet = computeDietFields(w);
    expect(diet.cal_diet_main_meals_complete).toBe(false);
    expect(diet.cal_diet_recorded_count).toBe(2);
    expect(diet.cal_diet_total).toBe(350);
  });

  it("Atwater factor は 4 (定数)", () => {
    expect(CHO_KCAL_PER_GRAM).toBe(4);
  });
});
