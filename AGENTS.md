# AGENTS.md

Guidance for AI coding agents (and humans) working on this repository. It is
intentionally generic — no personal data, IDs, or infrastructure details.

## What this project is

An MCP server that exposes the Intervals.icu REST API as typed tools for AI clients.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design; the essentials:

- `src/core/` — generic Intervals.icu access (client, cache, types, tools).
- `src/extensions/` — optional, self-contained add-ons (e.g. Stryd LBSS/PMC).
- `src/utils/` — pure, deterministic, unit-tested helpers (no I/O).
- `src/config.ts` — Zod-validated environment variables (`config_`).
- `src/instructions.ts` — `buildServerInstructions(timeZone)` text for AI clients.
- `src/tool-registry.ts` — `ToolDef` type + `TOOLS` array (transport-free source of truth).
- `src/adapters/` — thin per-surface adapters (`mcp.ts` `registerToolDef`, `cli.ts` `runToolDef`).
- `src/index.ts` — MCP composition root: registers `TOOLS` via `registerToolDef`, picks the transport.
- `src/cli.ts` — CLI composition root: dispatches `TOOLS` via `runToolDef` (independent of `index.ts`).

## Project conventions

- **No `console.log`.** It corrupts the stdio transport. Use `console.error` for
  diagnostics (kept consistent across stdio and HTTP modes).
- **Error model:** handlers return raw data on success and `throw` on hard failure;
  don't crash the process. Adapters do the shaping — MCP turns a throw into an
  `isError` response, the CLI prints to stderr and exits non-zero. Soft/partial
  failure is returned as success data (e.g. `{ errors }`), not thrown.
- **Tools are `export const xxxTool: ToolDef`** (one file each), collected in
  `TOOLS` in `src/tool-registry.ts`. Defaults/validation run in the adapters'
  `z.object(schema).parseAsync`, not in the handler.
- **One-way imports:** `core/` and `utils/` must not import from `extensions/`.
- **Dates are `YYYY-MM-DD` strings.** Civil-date arithmetic is timezone-independent;
  the configured `ATHLETE_TIMEZONE` is used only for instant→date conversions
  (`today()`, `formatDate()`).
- **`activity_id` inputs** use a Zod `.refine()` negative check (reject spaces /
  non-ASCII) rather than validating an `i\d+` format, for resilience to Intervals.icu
  changes. The `.describe()` tells the client to call `get_activities` first.
- **Don't reference new API fields by guessing.** Confirm field names against real
  `get_activity_detail` output first — the Intervals.icu schema changes often, so
  response types are kept loose on purpose.
- **License headers:** every `*.ts` file starts with
  `// SPDX-License-Identifier: AGPL-3.0-or-later`.

## Build, run, test

```bash
npm install
npm run build      # tsc -> build/
npm run dev        # run from source (stdio) via tsx
npm test           # vitest unit suite — keep it green
```

Tests live in `__tests__/` (vitest). Pure logic in `utils/` and `extensions/` should
be covered by unit tests. Run `npm test` before proposing changes.

## When adding features

- New core tool → add `src/core/tools/<name>.ts` exporting `export const <name>Tool:
  ToolDef`, then add it to `TOOLS` in `src/tool-registry.ts` (both MCP and CLI pick
  it up — no edit to `index.ts` or `cli.ts`).
- New extension → add `src/extensions/<name>/` (own types + pure calculators +
  `tools/`), importing only from `core/`/`utils/`. Add its tools to `TOOLS` in
  `src/tool-registry.ts`.
- Keep deterministic math in pure functions and unit-test it; hand the LLM finished
  numbers to interpret.
