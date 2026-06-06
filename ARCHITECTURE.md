# Architecture

This server exposes the [Intervals.icu](https://intervals.icu) REST API as a
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server, so an AI
client (Claude Desktop, Codex, etc.) can read and analyze a single athlete's
training data through well-typed tools.

## Directory layout

```
src/
├── index.ts                 # MCP composition root: registers TOOLS via registerToolDef, wires transports (stdio / HTTP)
├── cli.ts                   # CLI composition root: dispatches TOOLS via runToolDef (independent of index.ts)
├── tool-registry.ts         # ToolDef type + TOOLS array — the single, transport-free source of truth
├── config.ts                # Environment-variable validation (Zod). Exports config_
├── instructions.ts          # buildServerInstructions(timeZone) — guidance sent to AI clients
├── adapters/                # Thin per-surface adapters (transport-free; no express / index.ts imports)
│   ├── mcp.ts               # registerToolDef(server, tool) — Zod parse + MCP content envelope
│   └── cli.ts               # runToolDef(tool, args, {raw}) — Zod parse + JSON string for stdout
├── core/                    # Generic Intervals.icu access (no Stryd-specific logic)
│   ├── intervals-client.ts  # REST client — single request() helper + a thin method per endpoint
│   ├── cache.ts             # On-disk stream cache (immutable stream responses)
│   ├── types.ts             # API response / input types
│   └── tools/               # One file per tool: exports xxxTool: ToolDef
├── extensions/              # Optional, self-contained add-ons that depend on core/ + utils/
│   └── stryd/               # Stryd power-meter: LBSS-based PMC, weekly/phase summaries
│       ├── lbss-calculator.ts
│       ├── types.ts
│       └── tools/           # exports xxxTool: ToolDef
└── utils/                   # Pure, deterministic helpers (no I/O)
    ├── date.ts              # Civil-date arithmetic + timezone-aware today()/formatDate()
    ├── ema.ts               # Exponential moving average
    ├── stream-processing.ts # Stream splitting / decoupling / EF
    └── hrv-trends.ts        # Rolling HRV statistics
```

## Design principles

1. **Core / extension separation.** `core/` is a thin, generic wrapper over the
   Intervals.icu API. Anything specific to a metric ecosystem (e.g. Stryd's LBSS /
   ILR) lives under `extensions/`, so it can be added or removed independently.

2. **One-way dependencies.** `core/` and `utils/` **never import from
   `extensions/`**. Extensions import *down* into `core/` and `utils/`. Both layers
   meet only in `tool-registry.ts`, which collects every tool into `TOOLS` — the
   single source of truth. The two composition roots, `index.ts` (MCP) and `cli.ts`
   (CLI), consume `TOOLS` independently and do **not** import each other. (This
   invariant is easy to check: `grep -rn "extensions/" src/core src/utils` should
   return nothing.)

3. **Deterministic computation server-side.** EMA / PMC / decoupling and similar
   math are implemented as pure functions in `utils/` (and `extensions/`), unit
   tested, and given to the LLM as finished numbers — the model interprets, it does
   not recompute.

4. **Tool granularity.** Core tools return raw-ish data (flexible, token-heavy).
   Extension tools return pre-aggregated summaries (token-efficient, review-oriented).
   The client picks based on the task; `instructions.ts` guides that choice.

## Key patterns

### Tool definition — `export const xxxTool: ToolDef`

Every tool is one file exporting a single transport-free `ToolDef`
(`{ name, title, description, schema, handler }`). The handler returns **raw
data** — enveloping and formatting belong to the adapters, not the tool:

```ts
import type { ToolDef } from "../../tool-registry.js";

export const getActivitiesTool: ToolDef = {
  name: "get_activities",
  title: "Get Activities",
  description: "...",
  schema: { /* Zod input shape (defaults applied by the adapters' parseAsync) */ },
  handler: async (args) => {
    // ... call intervalsClient, shape the result ...
    return result; // raw data; hard failure → throw
  },
};
```

`tool-registry.ts` collects every `xxxTool` into `TOOLS`. The MCP root
(`index.ts`) registers them via `registerToolDef` (`adapters/mcp.ts`, which wraps
the result in the MCP content envelope); the CLI root (`cli.ts`) runs them via
`runToolDef` (`adapters/cli.ts`, which prints the JSON string). Adding a tool is:
create the file, export `yourTool: ToolDef`, add it to `TOOLS` in
`tool-registry.ts` — no change to `index.ts` or `cli.ts`.

### API client — a single `request()` helper

`core/intervals-client.ts` centralizes auth (HTTP Basic with the API key), URL +
query building, error handling, and empty-body (`204`) handling in one private
`request<T>()`. Each public method (`getActivities`, `createEvent`, …) is a thin
call into it. Stream responses are immutable, so `getActivityStreams()` reads
through `core/cache.ts` (disk cache) first.

## Caching

Only activity **stream data** is cached on disk (the `getActivityStreams` path).
PMC, activities, wellness, events, and every other endpoint are fetched live and
**not** cached.

- **Why it's safe.** Per-activity streams are immutable once recorded, so there is
  **no TTL and no automatic eviction** — a cache hit is always valid for the data it
  represents.
- **Location.** `CACHE_DIR`; when unset it resolves to an absolute
  `<package root>/cache/streams` from the server's own module location (not the
  launch CWD, which differs across clients). One file per activity, `{activityId}.json`.
- **The one caveat — upstream changes are not observed.** Intervals.icu does not
  notify the server when stream data changes underneath it. After **re-uploading a
  FIT file**, **re-running elevation correction**, or **trimming an activity**, the
  cached streams are stale and must be flushed manually: use the `clear_cache` tool
  (all activities, or a single `activity_id`) or `rm -rf <CACHE_DIR>`. Recomputing
  FTP/CP does **not** change streams, so no flush is needed for those. There is no
  automatic staleness detection by design — `Activity` carries no reliable
  stream-mtime, and inferring one would misfire on FTP/CP recomputes; instead the
  server prompts the user to flush when they mention an upstream edit.
- **On/off switch.** The persistent default comes from `CACHE_ENABLED` (default on).
  The `set_cache_enabled` tool flips it at runtime; that runtime flag is
  process-global (shared across HTTP sessions), **non-persistent**, and resets to the
  `CACHE_ENABLED` default on restart. While disabled, `cacheGet`/`cacheSet`
  short-circuit, so stream tools always fetch fresh and write nothing — and
  **disabling only *ignores* the cache, it does not delete it**: existing files
  remain until you flush them with `clear_cache`.

## Adding a new extension

1. Create `src/extensions/<name>/` with its own `types.ts`, pure calculators, and a
   `tools/` directory of files each exporting an `xxxTool: ToolDef`.
2. Import only from `core/` and `utils/` (never the reverse).
3. Add its tools to `TOOLS` in `tool-registry.ts` (both surfaces pick them up).

## Surfaces and transports

Tools are transport-free; each surface is a thin adapter over the shared `TOOLS`
registry. There are two composition roots:

- **MCP server** (`index.ts` + `adapters/mcp.ts`) — the AI-client surface. It
  selects a transport from `MCP_TRANSPORT`:

  | Mode | Value | Use |
  |---|---|---|
  | **stdio** (default) | `stdio` | Local client (Claude Desktop / Codex) launches the process directly. Recommended for personal use. |
  | **Streamable HTTP** | `http` | Express server bound to `0.0.0.0:<MCP_PORT>`, endpoints `POST/GET/DELETE /mcp` + `GET /health`. Multi-client, network-accessible. |

- **CLI** (`cli.ts` + `adapters/cli.ts`) — a terminal surface for the same tools:
  `cli list` prints the tool names; `cli <tool> '<json-args>' [--raw]` runs one tool
  and prints its JSON (pretty by default, compact with `--raw`). stdout carries pure
  JSON, stderr carries diagnostics, exit codes are `0`/`1`/`2`. `cli.ts` does not
  import `index.ts`, so the CLI never pulls in express or the MCP machinery.

HTTP mode has **no application-layer authentication** and binds to all interfaces.
Do **not** expose it to the public internet — see [SECURITY.md](SECURITY.md). For a
single user on one machine, stdio is simpler and safer.
