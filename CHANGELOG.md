# Changelog

All notable changes to this project will be documented in this file.

## [0.12.0] — 2026-06-11

### Breaking Changes

- **Removed `include_legacy` param** from `get_weekly_summary` and `get_current_pmc`.
  The `lbss_legacy` key is no longer emitted in tool output.
  To compare against an older or alternative LBSS field ad-hoc, pass `lbss_field` per-call
  (e.g. `lbss_field: "StrydLBSSmod"`).
- **Removed `LBSS_FIELD_LEGACY` env var**. The server no longer reads this variable;
  any existing `.env` entry is silently ignored (Zod unknown-key strip).
  Remove the line from your `.env` and MCPB user_config if present.

### New Features

- **`avg_stride_length_m`** per split and overall in `get_activity_streams_summary`.
  Derived as velocity / (cadence_stream × 2 / 60); uses the run cadence stream (rpm,
  one-foot), verified against Intervals.icu `average_cadence`.

- **`EXTRA_STREAM_FIELDS`** env var — comma-separated Intervals custom stream codes
  (e.g. `StrydLSS,StrydTemp,StrydHumidity`) fetched and surfaced as `extras` per split
  and overall in `get_activity_streams_summary`. Requires custom stream mapping on an
  Intervals.icu activity page (CHARTS → CUSTOM STREAMS → ADD STREAM). Backward-compatible:
  `extras` key is absent when not configured.

- **`run_fraction` + `extras_run`** in `get_activity_streams_summary`.
  `run_fraction`: share of valid samples at or above the run-gate cadence threshold
  (default 70 rpm = 140 spm), per split and overall.
  `extras_run`: extras averages restricted to running samples only, for separating
  per-stride metric change from walk-mix dilution (e.g. StrydLSS stiffness drift vs.
  gait-mix change in ultra-distance races).
  Configurable via `run_gate_cadence_rpm` param (range 40–120).
  Both keys absent when cadence stream is not present (backward-compatible).

- **`run_gate_cadence_rpm`** param in `get_activity_streams_summary` (default 70,
  range 40–120). Echoed in `data_quality.run_gate_cadence_rpm`.

### Internal

- `LBSS_FIELD_LEGACY` / `lbssFieldLegacy` removed from config, tool registry, and
  MCPB `manifest.json` `user_config`.
- `.env.example` reorganized into **Activity custom fields** and **Streams** sections.
- `manifest.json` `user_config`: removed `lbss_field_legacy`, added `extra_stream_fields`.
