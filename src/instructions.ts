// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCP server instructions sent to AI clients during initialization.
 * Helps the client understand conventions, recommended workflows,
 * and domain-specific context for this server.
 */
export function buildServerInstructions(timeZone: string): string {
  return `
This server provides access to Intervals.icu training data for a single athlete.

## Key conventions
- Timezone: All dates use the athlete's configured timezone (${timeZone}). Use YYYY-MM-DD format.
- Week boundaries: Monday–Sunday (ISO week).
- Activity IDs: Short alphanumeric strings like "i12345678" — these are NOT activity names. Always obtain IDs from get_activities results before calling other tools.
- Response format: All tool responses return JSON strings.

## Recommended workflow
1. get_activities — List activities for a date range. Returns compact summary by default (9 key fields). Use fields="full" only when you need all metrics. Use this FIRST to obtain activity IDs, then call get_activity_detail or get_activity_streams_summary for deep analysis.
2. get_activity_detail — Full metrics for one activity (power/HR zones, Stryd metrics, decoupling). Requires an activity_id from step 1.
3. get_activity_streams_summary — Split-based analysis with cardiac decoupling and pacing. Requires an activity_id from step 1.
4. search_similar_activities — Find past activities in a date range matching optional filters (type, name keyword, distance, duration, feels-like temperature). Returns per-activity derived metrics (pace, efficiency factor, weather) and an aggregate summary (avg RSS/LBSS/ILR). Temperature filter uses Open-Meteo \`average_feels_like\`; activities with \`has_weather=false\` are excluded when temp filter is set. Use to estimate LBSS/RSS of planned sessions from similar past efforts.
5. get_weekly_summary — Mon–Sun aggregated training load (RSS, LBSS, time, distance) and end-of-week PMC values for both RSS and LBSS.
6. get_phase_summary — Aggregate a multi-week training phase (start_date = Monday, end_date = Sunday). Returns phase totals, per-week breakdown (totals + averages + PMC snapshot for both RSS and LBSS), and trends with CTL ramp rate. Use for block-level analysis (training blocks, e.g., base, build, taper) and ramp rate diagnostics.
7. get_current_pmc — Today's dual PMC snapshot: RSS-based (from Intervals.icu) and LBSS-based (computed server-side).
8. get_wellness — Daily wellness data (HRV, resting HR, sleep, weight) for a date range. Returns the raw Intervals.icu wellness records, including any custom fields the athlete logs (e.g. kcalConsumed).
9. get_athlete_summary — Athlete-level summary stats for a date range.
10. get_events — Calendar events (planned workouts, races, notes) for a date range. Optional category filter. Use with get_activities to compare planned vs actual training.
11. create_events — Create one or more calendar events (planned workouts, races, notes). Accepts an array for batch loading (up to 14 at a time). Use for loading training plans onto the calendar.
12. update_event — Update an existing calendar event. Requires event_id from get_events. Only include fields to change.
13. delete_event — Delete a calendar event. Requires event_id from get_events. Irreversible.
14. delete_events — Delete multiple calendar events in one call. Accepts an array of event IDs (up to 30). Use for clearing a week of planned training before re-loading.
15. get_hrv_trends — Rolling HRV statistics (mean, SD, CV%) for recovery trend analysis. Use 7-day window for weekly patterns, 14–30 for longer-term stability. CV% quantifies day-to-day HRV stability: low CV = stable autonomic regulation, high CV = potential stress accumulation. Always interpret CV alongside hrv_mean direction and rhr_mean.
16. clear_cache — Clears the on-disk stream cache (all, or a single activity). The server is NOT notified of upstream changes, so when the user says they re-uploaded a FIT file, changed elevation correction, trimmed, or otherwise edited an activity on Intervals.icu, proactively flush that activity with clear_cache before re-analyzing it, and tell the user you did so. (Changing FTP or CP does not affect streams, so no flush is needed there.)
17. set_cache_enabled — Turns the on-disk stream cache on/off at runtime, or (with no argument) reports its current state. While disabled, stream tools always fetch fresh and write nothing, and existing cached files are ignored (not deleted). Resets to the CACHE_ENABLED env default on restart.

## Tool selection guide
- Need activity IDs or a quick overview? → get_activities (summary mode, default)
- Need detailed metrics for ONE activity? → get_activity_detail
- Need stream-level analysis (splits, decoupling)? → get_activity_streams_summary
- Need to find sessions matching criteria (type, name, distance, duration) with aggregate stats? → search_similar_activities
- Need a lightweight date-range aggregate (totals/averages without per-activity detail)? → get_athlete_summary
- Need weekly/phase-level training load trends? → get_weekly_summary or get_phase_summary
- Need today's dual PMC snapshot (RSS + LBSS CTL/ATL/TSB)? → get_current_pmc
- Need to load a training plan onto the calendar? → create_events (batch mode)
- Need to adjust a planned workout? → update_event
- Need to remove a planned workout? → delete_event
- Need to clear and reload a week of planned training? → get_events (to find IDs) then delete_events, then create_events
- Always use get_events first to find event IDs before update/delete.
- Need daily recovery/wellness data (HRV, resting HR, sleep, weight, custom logged fields)? → get_wellness
- Need HRV recovery trends or autonomic stability? → get_hrv_trends (rolling CV%, mean, SD)
- Re-uploaded a FIT file or re-ran elevation correction and stream analysis looks stale? → clear_cache (all, or one activity_id), then re-run get_activity_streams_summary
- Want to bypass the stream cache entirely (always fetch fresh), or check whether caching is on? → set_cache_enabled (omit the argument to query)

## Metrics reference
- When Stryd power data is present, the server surfaces: RSS (Running Stress Score), LBSS (Lower Body Stress Score), ILR (Impact Loading Rate).
- LBSS-based PMC (CTL/ATL/TSB) is computed server-side via EMA, distinct from Intervals.icu's built-in RSS-based PMC. Tools that return PMC provide both.

## Wellness data: field interpretation
- Subjective fields (sleepQuality, soreness, fatigue, motivation) in Intervals.icu commonly use a 1–4 scale. The direction depends on the logging app — verify yours. (HRV4Training, for example, uses 1 = best, 4 = worst, which is counter-intuitive.)
- Numeric fields follow normal direction (higher = better), e.g. Garmin sleepScore (0–100).
- The \`hrv\` field is rMSSD (ms); \`hrvSDNN\` is a different metric. Pair HRV with restingHR.
`.trim();
}
