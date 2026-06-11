// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MCP server instructions sent to AI clients during initialization.
 * Helps the client understand conventions, recommended workflows,
 * and domain-specific context for this server.
 */
export function buildServerInstructions(
  timeZone: string,
  lbssField: string,
): string {
  return `
This server provides access to Intervals.icu training data for a single athlete.

## Key conventions
- Timezone: All dates use the athlete's configured timezone (${timeZone}). Use YYYY-MM-DD format.
- Week boundaries: Monday–Sunday (ISO week).
- Activity IDs: Short alphanumeric strings like "i12345678" — these are NOT activity names. Always obtain IDs from get_activities results before calling other tools.
- Response format: All tool responses return JSON strings.
- Read-only mode: When the server runs with READ_ONLY=true, the account-writing tools (create_events, update_event, delete_event, delete_events, assign_gear, create_gear, retire_gear, update_lbss_ci_table) are not registered and are unavailable.

## Recommended workflow
1. get_activities — List activities for a date range. Returns compact summary by default (9 key fields). Use fields="full" only when you need all metrics. Use this FIRST to obtain activity IDs, then call get_activity_detail or get_activity_streams_summary for deep analysis.
2. get_activity_detail — Full metrics for one activity (power/HR zones, Stryd metrics, decoupling). Requires an activity_id from step 1.
3. get_activity_streams_summary — Split-based analysis with cardiac decoupling, per-split stride length, and pacing; when cadence data is present, each split includes run_fraction (running-sample share) and, when EXTRA_STREAM_FIELDS is configured, extras_run (extras restricted to running samples) alongside extras. Requires an activity_id from step 1.
4. search_similar_activities — Find past activities in a date range matching optional filters (type, name keyword, distance, duration, feels-like temperature). Returns per-activity derived metrics (pace, efficiency factor, weather) and an aggregate summary (avg RSS/LBSS/ILR). Temperature filter uses Open-Meteo \`average_feels_like\`; activities with \`has_weather=false\` are excluded when temp filter is set. Use to estimate LBSS/RSS of planned sessions from similar past efforts. Set include_ecc=true to add eccentric LBSS (env ECC_FIELD) as a per-activity \`ecc\` field and summary.avg_ecc.
5. get_weekly_summary — Mon–Sun aggregated training load (RSS, LBSS, time, distance) and end-of-week PMC values for both RSS and LBSS. LBSS is read from the configured custom field (override per call with lbss_field). Pass include_ecc=true to add eccentric LBSS (env ECC_FIELD) as totals.ecc / sessions[].ecc (no Ecc-PMC).
6. get_phase_summary — Aggregate a multi-week training phase (start_date = Monday, end_date = Sunday). Returns phase totals, per-week breakdown (totals + averages + PMC snapshot for both RSS and LBSS), and trends with CTL ramp rate. Use for block-level analysis (training blocks, e.g., base, build, taper) and ramp rate diagnostics. Pass include_ecc=true to add eccentric LBSS (env ECC_FIELD) as weekly totals and a trends.ecc_weekly series (no Ecc-PMC).
7. get_current_pmc — Today's dual PMC snapshot: RSS-based (from Intervals.icu) and LBSS-based (computed server-side).
8. get_wellness — Daily wellness data (HRV, resting HR, sleep, weight) for a date range. Returns the raw Intervals.icu wellness records, including any custom fields the athlete logs (e.g. kcalConsumed).
9. get_athlete_summary — Athlete-level summary stats for a date range.
10. get_events — Calendar events (planned workouts, races, notes) for a date range. Optional category filter. Use with get_activities to compare planned vs actual training.
11. create_events — Create one or more calendar events (planned workouts, races, notes). Accepts an array for batch loading (up to 14 at a time). Use for loading training plans onto the calendar.
12. update_event — Update an existing calendar event. Requires event_id from get_events. Only include fields to change.
13. delete_event — Delete a calendar event. Requires event_id from get_events. Irreversible.
14. delete_events — Delete multiple calendar events in one call. Accepts an array of event IDs (up to 30). Use for clearing a week of planned training before re-loading.
15. get_hrv_trends — Rolling HRV statistics (mean, SD, CV%) for recovery trend analysis. Use 7-day window for weekly patterns, 14–30 for longer-term stability. CV% quantifies day-to-day HRV stability: low CV = stable autonomic regulation, high CV = potential stress accumulation. Always interpret CV alongside hrv_mean direction and rhr_mean.
16. list_gear — List all gear (shoes/bikes) with IDs and odometer (distance/time). Raw passthrough including retired gear. Use to find a gear_id before assign_gear, or to see per-shoe mileage.
17. assign_gear — Attach a gear (shoe) to one or more activities (writes to the account; withheld in READ_ONLY). For new activities that synced without gear, a natural flow in a daily review is: get_activities (spot the ones with no gear) → list_gear → suggest the recently-used shoe → confirm with the user → assign_gear. Activities already on the target gear are skipped. Re-assigning a different gear fixes a mistake (there is no unassign).
18. create_gear — Create a new gear item (shoe/bike) (writes to the account; withheld in READ_ONLY). Ask for the model name, purchase date, and notes. The returned id is usable immediately with assign_gear. See the buy/retire workflow below for carrying CI forward.
19. retire_gear — Retire a shoe so it stops showing as a default assignment (writes to the account; withheld in READ_ONLY). Un-retire is out of scope (use the Intervals.icu UI). Consider estimate_critical_impact on the retiring shoe to seed the successor's CI.
20. clear_cache — Clears the on-disk stream cache (all, or a single activity). The server is NOT notified of upstream changes, so when the user says they re-uploaded a FIT file, changed elevation correction, trimmed, or otherwise edited an activity on Intervals.icu, proactively flush that activity with clear_cache before re-analyzing it, and tell the user you did so. (Changing FTP or CP does not affect streams, so no flush is needed there.)
21. set_cache_enabled — Turns the on-disk stream cache on/off at runtime, or (with no argument) reports its current state. While disabled, stream tools always fetch fresh and write nothing, and existing cached files are ignored (not deleted). Resets to the CACHE_ENABLED env default on restart.
22. estimate_critical_impact — Reverse-estimate Stryd Critical Impact (CI) for LBSS v2 calibration from Intervals streams (watts/ILR/altitude/distance) + Critical Power, no Stryd API. Deterministic weighted regression over flat seconds in a lookback window (default 90 days). Requires cp_watts. Optional gear_id restricts to one shoe; as_of backtests a past date. The first call on a cold cache fetches many activity streams (slower); returns ci_estimate=null with a warning when intensity coverage is thin (taper) or history < 60 days. Coverage warnings also flag thin flat-second weight / few activities even when the gates pass — treat those estimates as indicative.
23. update_lbss_ci_table — Write the per-shoe CI table into the LBSS custom-field scripts (writes to the account; withheld in READ_ONLY). Updates the LBSS field and the Ecc field together (CI must stay identical across both). dry-run by default — call once to preview the before/after table per field, then again with apply:true to write. Only the managed CI_TABLE sentinel line is rewritten; if a field script hasn't adopted that contract, nothing is written. Build values with estimate_critical_impact(gear_id=…) first. After writing, re-analysis of past data is a manual Intervals.icu UI step (the tool returns a reanalysis_note).

## Tool selection guide
- Need activity IDs or a quick overview? → get_activities (summary mode, default)
- Need detailed metrics for ONE activity? → get_activity_detail
- Need stream-level analysis (splits, decoupling)? → get_activity_streams_summary
- Need to find sessions matching criteria (type, name, distance, duration) with aggregate stats? → search_similar_activities
- Need a lightweight date-range aggregate (totals/averages without per-activity detail)? → get_athlete_summary
- Need weekly/phase-level training load trends? → get_weekly_summary or get_phase_summary
- Need today's dual PMC snapshot (RSS + LBSS CTL/ATL/TSB)? → get_current_pmc
- Need to calibrate Stryd Critical Impact (CI) for LBSS v2 without the Stryd API? → estimate_critical_impact (give cp_watts; optional gear_id for a per-shoe estimate)
- Need to load a training plan onto the calendar? → create_events (batch mode)
- Need to adjust a planned workout? → update_event
- Need to remove a planned workout? → delete_event
- Need to clear and reload a week of planned training? → get_events (to find IDs) then delete_events, then create_events
- Always use get_events first to find event IDs before update/delete.
- Need daily recovery/wellness data (HRV, resting HR, sleep, weight, custom logged fields)? → get_wellness
- Need HRV recovery trends or autonomic stability? → get_hrv_trends (rolling CV%, mean, SD)
- Need to see your shoes/bikes and their mileage, or look up a gear_id? → list_gear
- Need to attach a shoe to one or more activities (e.g. new runs that synced without gear)? → assign_gear (confirm the shoe with the user first; use list_gear for the gear_id)
- Bought a new shoe? → create_gear (ask model/purchase date/notes), then seed its CI from the lineage (buy/retire workflow below)
- Retiring a shoe? → retire_gear (consider carrying CI forward to the successor first)
- Need split-level impact load (per-segment avg_ilr / ilr_p95)? → get_activity_streams_summary (already returns these per split when the ILR field has data)
- Need to write updated per-shoe CI values into the LBSS fields? → update_lbss_ci_table (dry-run first; estimate the values with estimate_critical_impact)
- Re-uploaded a FIT file or re-ran elevation correction and stream analysis looks stale? → clear_cache (all, or one activity_id), then re-run get_activity_streams_summary
- Want to bypass the stream cache entirely (always fetch fresh), or check whether caching is on? → set_cache_enabled (omit the argument to query)

## Gear lifecycle & CI inheritance
When the user buys a new shoe, a useful flow is: create_gear (ask for model, purchase date, notes) → list_gear to understand the rotation and spot the lineage (e.g. a Clifton 10 succeeding a Clifton 9 — identifying the predecessor is a naming/context judgment, yours to make, not a lookup). The new shoe has no Critical Impact (CI) history yet, so seed it from the predecessor: estimate_critical_impact with gear_id = the old shoe, window_days spanning that shoe's life, and as_of near its last use gives a lineage CI you can suggest as the starting value and record in the new shoe's notes. If a shoe is being replaced, retire_gear the old one. Around 60 days in, re-calibrate from the new shoe's own runs (estimate_critical_impact with its gear_id). There is no dedicated CI-suggestion tool — this is a conversational workflow over estimate_critical_impact, whose deterministic regression does the math. To persist the values, update_lbss_ci_table writes the per-gear CI table into the LBSS field scripts (dry-run first; it updates the LBSS and Ecc fields together so their CI stays identical). CI is a trajectory, not a constant (one shoe drifted -10 across its life), so prefer recent-window estimates refreshed monthly over a lifetime pool, and remember that applying a new table to past activities is a manual UI re-analysis.

## Metrics reference
- When Stryd power data is present, the server surfaces: RSS (Running Stress Score), LBSS (Lower Body Stress Score), ILR (Impact Loading Rate).
- LBSS-based PMC (CTL/ATL/TSB) is computed server-side via EMA, distinct from Intervals.icu's built-in RSS-based PMC. Tools that return PMC provide both.
- The LBSS and ILR custom-field names are configurable (env LBSS_FIELD / ILR_FIELD; the LBSS aggregation tools also accept a per-call lbss_field). This server reads LBSS from "${lbssField}" by default. To compare against an older or alternative LBSS field, pass lbss_field per-call. If your account uses different custom-field codes, set LBSS_FIELD / ILR_FIELD. Field recipes: https://github.com/methylone/Intervals-MCP-Server-with-STRYD/wiki/LLM-Agent-Recipes

## Wellness data: field interpretation
- Subjective fields (sleepQuality, soreness, fatigue, motivation) in Intervals.icu commonly use a 1–4 scale. The direction depends on the logging app — verify yours. (HRV4Training, for example, uses 1 = best, 4 = worst, which is counter-intuitive.)
- Numeric fields follow normal direction (higher = better), e.g. Garmin sleepScore (0–100).
- The \`hrv\` field is rMSSD (ms); \`hrvSDNN\` is a different metric. Pair HRV with restingHR.
`.trim();
}
