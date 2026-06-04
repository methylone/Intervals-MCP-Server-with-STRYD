// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Intervals.icu API response types.
 *
 * Only essential fields are explicitly typed.
 * All types extend Record<string, unknown> via intersection to accommodate
 * undocumented or schema-changed fields without type errors.
 */

// ---------------------------------------------------------------------------
// Activity (GET /athlete/{id}/activities, GET /activity/{id})
// ---------------------------------------------------------------------------

export type Activity = {
  id: string;
  name: string;
  /** e.g. "Run", "VirtualRun" */
  type: string;
  /** ISO 8601 local datetime string */
  start_date_local: string;
  /** seconds */
  moving_time: number;
  /** meters */
  distance: number;

  // --- Training load ---
  /** RSS: Running Stress Score (Intervals edition of TSS) */
  icu_training_load?: number;
  /** CTL based on RSS (pre-calculated by Intervals) */
  icu_ctl?: number;
  /** ATL based on RSS (pre-calculated by Intervals) */
  icu_atl?: number;
  trimp?: number;
  /** HR-based load (HRSS) */
  hr_load?: number;

  // --- Stryd custom streams (present only when synced; post Nov 2025) ---
  /** Lower Body Stress Score (Modified) */
  StrydLBSSmod?: number;
  /** Impact Loading Rate */
  StrydILR?: number;
  /** ILR threshold */
  StrydILRTreshold?: number;

  // --- Quality metrics ---
  /** Heart rate–power decoupling (%) */
  decoupling?: number;
  /** RPE 1–10 */
  icu_rpe?: number;
  /** RPE × duration */
  session_rpe?: number;

  // --- Environment ---
  /** Average temperature from device sensor (°C) — has body-heat bias, DO NOT use for analysis */
  average_temp?: number;
  /** Open-Meteo forecast temperature (°C) */
  average_weather_temp?: number;
  /** Open-Meteo feels-like temperature (°C) */
  average_feels_like?: number;
  /** Open-Meteo wind speed (m/s) */
  average_wind_speed?: number;
  /** Whether Open-Meteo weather data is attached */
  has_weather?: boolean;

  // --- Elevation ---
  total_elevation_gain?: number;

  // --- Zone distributions ---
  icu_zone_times?: number[];
  icu_hr_zone_times?: number[];

  // --- Nutrition ---
  /** Carbohydrates ingested during activity (grams). Intervals.icu field: `carbs_ingested`. */
  carbs_ingested?: number | null;
  /** Carbohydrates oxidized/used during activity (grams). Not used by FR-NUTR-01. */
  carbs_used?: number | null;
} & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Wellness (GET /athlete/{id}/wellness)
// ---------------------------------------------------------------------------

export type Wellness = {
  /** YYYY-MM-DD */
  id: string;
  weight?: number;

  // --- Recovery metrics (primary) ---
  /** rMSSD (ms). PRIMARY HRV metric for recovery assessment. Higher = better recovery.
   *  Source: HRV4Training morning measurement. */
  hrv?: number;
  /** Resting heart rate (bpm). Use WITH hrv for recovery judgment.
   *  Source: HRV4Training morning measurement. */
  restingHR?: number;

  // --- Sleep ---
  /** Sleep duration (seconds). Source: Garmin. */
  sleepSecs?: number;
  /** Garmin sleep score (0–100). Higher = better. Source: Garmin. */
  sleepScore?: number;
  /** Subjective sleep quality. Source: HRV4Training.
   *  INVERTED SCALE: 1=Great, 2=Good, 3=Average, 4=Poor */
  sleepQuality?: number;

  // --- Subjective wellness (all INVERTED: 1=best, 4=worst) ---
  /** Muscle soreness. Source: HRV4Training.
   *  INVERTED SCALE: 1=Low, 2=Avg, 3=High, 4=Extreme */
  soreness?: number;
  /** Fatigue level. Source: HRV4Training.
   *  INVERTED SCALE: 1=Low, 2=Avg, 3=High, 4=Extreme */
  fatigue?: number;
  /** Mental energy / motivation. Source: HRV4Training.
   *  INVERTED SCALE: 1=Extreme(best), 2=High, 3=Avg, 4=Low(worst) */
  motivation?: number;

  // --- Reference metrics (do NOT use for threshold decisions) ---
  /** SDNN (ms). Reference only — mixes sympathetic/parasympathetic signals.
   *  Use hrv (rMSSD) instead for recovery assessment. Source: HRV4Training. */
  hrvSDNN?: number;
  /** HRV4Training composite readiness score (~5–10). Higher = better.
   *  Reference only — nonlinear transform of rMSSD with undocumented scale.
   *  Use hrv (rMSSD) for threshold decisions. Source: HRV4Training. */
  readiness?: number;

  // --- PMC (pre-calculated by Intervals.icu) ---
  /** CTL at this date (RSS-based) */
  ctl?: number;
  /** ATL at this date (RSS-based) */
  atl?: number;
  tsb?: number;

  // --- Derived nutrition fields (computed by get_wellness, FR-NUTR-01) ---
  /** Sum of 5 meal kcal fields (null treated as 0). Always number. */
  cal_diet_total?: number;
  /** CalBreakfast, CalLunch, CalDinner all non-null (0 is non-null). */
  cal_diet_main_meals_complete?: boolean;
  /** Count of non-null among 5 meal fields. 0-5. */
  cal_diet_recorded_count?: number;
  /** Same-date activities' carbohydrates × 4. NULL iff activity fetch failed. */
  cal_workout_intake?: number | null;
  /** cal_diet_total + cal_workout_intake. NULL iff cal_workout_intake is null. */
  cal_intake_total?: number | null;
} & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Athlete Summary (GET /athlete/{id}/athlete-summary)
// ---------------------------------------------------------------------------

export type AthleteSummary = {
  id: string;
  ctl?: number;
  atl?: number;
  tsb?: number;
} & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Activity Streams (GET /activity/{id}/streams.json)
// ---------------------------------------------------------------------------

export type ActivityStreamRaw = {
  type: string;
  data: (number | null)[];
};

// ---------------------------------------------------------------------------
// Event / planned workout (GET /athlete/{id}/events)
// ---------------------------------------------------------------------------

export type CalendarEvent = {
  id: number;
  name: string;
  /** ISO 8601 local datetime string */
  start_date_local: string;
  /** e.g. "Workout", "Race", "Note" */
  category?: string;
  /** planned load target */
  load_target?: number;
} & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Event creation / update inputs
// ---------------------------------------------------------------------------

export type CreateEventInput = {
  /** Event name (e.g., "Easy 60min", "Long Run 30km") */
  name: string;
  /** ISO 8601 local datetime (e.g., "2026-04-14T06:00:00") */
  start_date_local: string;
  /** WORKOUT, NOTE, or RACE */
  category: "WORKOUT" | "NOTE" | "RACE_A" | "RACE_B" | "RACE_C";
  /** Sport type — required for WORKOUT (e.g., "Run", "Ride", "Swim") */
  type?: string;
  /** Free-text description (workout details, notes) */
  description?: string;
  /** Planned training load (RSS) */
  load_target?: number;
  /** Planned duration in seconds */
  moving_time?: number;
  /** Color label for calendar display */
  color?: string;
};

export type UpdateEventInput = Partial<CreateEventInput>;
