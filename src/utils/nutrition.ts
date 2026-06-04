// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * FR-NUTR-01: Derived nutrition fields for get_wellness.
 *
 * Pure functions — no I/O. Tool layer is responsible for fetching activities
 * and handling fetch failures (passing null when fetch failed).
 *
 * Spec: docs/FR-NUTR-01.md (r2)
 */

import type { Activity, Wellness } from "../core/types.js";

/** Atwater general factor for carbohydrate. */
export const CHO_KCAL_PER_GRAM = 4;

const MEAL_FIELDS = [
  "CalBreakfast",
  "CalLunch",
  "CalDinner",
  "CalSnack1",
  "CalSnack2",
] as const;

const MAIN_MEAL_FIELDS = ["CalBreakfast", "CalLunch", "CalDinner"] as const;

function readMeal(wellness: Wellness, key: string): number | null {
  const v = (wellness as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function computeDietFields(wellness: Wellness): {
  cal_diet_total: number;
  cal_diet_main_meals_complete: boolean;
  cal_diet_recorded_count: number;
} {
  let total = 0;
  let recordedCount = 0;
  for (const key of MEAL_FIELDS) {
    const value = readMeal(wellness, key);
    if (value !== null) {
      total += value;
      recordedCount += 1;
    }
  }

  const mainComplete = MAIN_MEAL_FIELDS.every(
    (key) => readMeal(wellness, key) !== null
  );

  return {
    cal_diet_total: total,
    cal_diet_main_meals_complete: mainComplete,
    cal_diet_recorded_count: recordedCount,
  };
}

/**
 * CRITICAL INVARIANT: activities === null → return null (activity fetch failed).
 * activities is an array → filter same-date and sum CHO × 4 (null CHO is 0).
 */
export function computeWorkoutIntake(
  activities: Activity[] | null,
  wellnessDate: string
): number | null {
  if (activities === null) return null;

  let totalCho = 0;
  for (const activity of activities) {
    const startLocal = activity.start_date_local;
    if (typeof startLocal !== "string" || startLocal.length < 10) {
      continue;
    }
    if (startLocal.slice(0, 10) !== wellnessDate) {
      continue;
    }
    const cho = activity.carbs_ingested;
    if (typeof cho === "number" && Number.isFinite(cho)) {
      totalCho += cho;
    }
  }

  return totalCho * CHO_KCAL_PER_GRAM;
}

export function computeNutritionDerived(
  wellness: Wellness,
  activities: Activity[] | null
): {
  cal_diet_total: number;
  cal_diet_main_meals_complete: boolean;
  cal_diet_recorded_count: number;
  cal_workout_intake: number | null;
  cal_intake_total: number | null;
} {
  const diet = computeDietFields(wellness);
  const workoutIntake = computeWorkoutIntake(activities, wellness.id);
  const intakeTotal =
    workoutIntake === null ? null : diet.cal_diet_total + workoutIntake;

  return {
    ...diet,
    cal_workout_intake: workoutIntake,
    cal_intake_total: intakeTotal,
  };
}
