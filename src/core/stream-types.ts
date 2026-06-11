// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stream-type catalogs shared by the stream-fetching client and its consumers.
 *
 * Two lists:
 *  - SUMMARY_STREAM_TYPES — the types get_activity_streams_summary needs for
 *    split/decoupling/EF analysis. Used as the cache-hit `requiredTypes` for
 *    that tool (hit judgment is unchanged from before).
 *  - canonicalStreamTypes() — the SUPERSET actually fetched from the API for
 *    EVERY stream request, so one cache entry serves every consumer. It adds
 *    raw `watts` / `altitude` and the configured ILR field on top of the
 *    summary list. This is config-dependent (ILR field name), so it is a lazy
 *    function — module load must not read config (credential-free paths), the
 *    same discipline used for lbssField.
 *
 * Lives in its own module (not in get-streams-summary.ts) so intervals-client.ts
 * can import the canonical superset without a circular import.
 */
import { config_ } from "../config.js";

/** Types get_activity_streams_summary aggregates. */
export const SUMMARY_STREAM_TYPES = [
  "time",
  "fixed_heartrate",
  "velocity_smooth",
  "distance",
  "ga_velocity",
  "fixed_watts",
  "grade_smooth",
  // "temp" — device temp excluded; weather data comes from activity-level fields
  "cadence",
] as const;

/**
 * The superset fetched for every stream request: summary types plus raw watts,
 * altitude, the configured ILR field (estimate_critical_impact needs these),
 * and any extra stream codes from EXTRA_STREAM_FIELDS.
 * Fetching the superset every time — and recording it in the cache envelope —
 * means a later request for ILR/altitude on an activity first cached by the
 * summary tool is a real hit, not a silent partial-data miss (envelope v2).
 */
export function canonicalStreamTypes(): string[] {
  return [
    ...new Set<string>([
      ...SUMMARY_STREAM_TYPES,
      "watts",
      "altitude",
      config_.ilrField,
      ...config_.extraStreamFields,
    ]),
  ];
}
