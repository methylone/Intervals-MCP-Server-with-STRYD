# Intervals MCP Server — CLI guide

The same tools the MCP server exposes can be run directly from a shell, without the
MCP protocol. The CLI runs **one tool**, prints its result as JSON to stdout, and
exits — no daemon, no session, no LLM.

## Invocation

If you installed the npm package, the `intervals-mcp` binary is on your `PATH`:

```bash
intervals-mcp list                      # list the registered tools
intervals-mcp <tool> '<json-args>'      # run one tool (args = a JSON object string; default {})
intervals-mcp <tool> '<json>' --raw     # compact JSON (pretty is the default)
intervals-mcp --help
```

From a source checkout, the equivalent is `node build/cli.js …` (or `npm run cli -- …`):

```bash
node build/cli.js list
node build/cli.js get_current_pmc
node build/cli.js get_weekly_summary '{"week_start":"2026-06-01"}'
```

- stdout carries **pure JSON only**; diagnostics, logs, and errors go to **stderr** —
  so `| jq` works cleanly.
- Auth comes from `.env` (`INTERVALS_API_KEY` / `INTERVALS_ATHLETE_ID`), never from
  flags (so credentials don't leak via `ps`). Under npm/npx, export them in the
  environment or run from a checkout that has a `.env`.
- Exit codes: `0` success / `1` tool error / `2` argument error.
- `npm run cli -- <tool> '<json>'` also works, but for piping prefer the direct
  `intervals-mcp` / `node build/cli.js` form (no risk of an npm banner contaminating
  stdout).

## When to use the CLI vs. Claude (MCP) — the important part

These are not "easy mode vs. hard mode" — they serve **different purposes**:

- **CLI** → when you want **data / numbers**. Deterministic, scriptable, zero-token.
  It does **not** interpret.
- **Claude (over MCP)** → when you want **interpretation / analysis**: judging training
  load, planned-vs-actual deviation, recommendations.

"MCP setup is a hassle, so I'll use the CLI" is only half right. More precisely: if what
you want is numbers rather than interpretation, the conversational protocol is simply
overkill. If you want interpretation, the CLI cannot substitute — it only emits raw JSON.

## Good fits

- **Unattended automation** (cron / systemd timer / CI). E.g. fetch `get_current_pmc`
  every morning and insert it into a time-series DB, or feed a home dashboard / Home
  Assistant sensor. LLMs are a poor fit for unattended runs (cost, non-determinism).
- **Pipeline composition** (jq / sqlite / quick plots):
  `node build/cli.js get_activities '{…}' | jq …`.
- **Ad-hoc terminal queries** (already SSH'd in, "just today's PMC" — low latency,
  deterministic).
- **Checking / debugging the server itself** — exercise a tool without standing up
  Claude Desktop and the bridge stack (a fast dev loop).
- **Reproducible scripted reports / headless / SSH environments.**

## What it can't do — limits (read this)

The CLI **returns raw data and interprets nothing.** And one structural fact matters:

> **The server's methodology guidance (`buildServerInstructions()`) does not reach CLI
> consumers.** It is injected only into the context of an LLM connected as an MCP client.
> A script or agent that calls the CLI **gets the data but not the methodology.**

This has bitten real use. Hand raw data to a context-free agent and you get
**plausible-but-wrong, generic-fitness-app misreadings**. A real (anonymized) example:

- An analysis agent concluded "resting HR ↑, estimated VO2max ↓, eFTP ↓, HRV ↓ =
  functional overreaching / chronic fatigue." Superficially reasonable.
- But this athlete is ultra-oriented (easy pace + large vertical gain). **VO2max and
  eFTP are *modeled* estimates** that fall benignly for this training type: Garmin
  VO2max is a pace-vs-HR regression (so it drops on slow / uphill running), and eFTP
  sags without high-intensity data. HRV had actually stepped down once early and then
  held roughly flat. Much of the "decline" was **taper-induced appearance** mistaken
  for fatigue.
- In a special context like ultra, generic interpretation is not enough — the
  **methodology (LBSS, dual PMC, rMSSD/CV, how to treat modeled metrics)** is what makes
  the conclusion right or wrong.

Other limits:

- **It won't discover arguments for you.** The consumer needs to know the tool name and
  schema; `list` gives names but not argument shapes. For exploratory use, Claude (MCP)
  is better — it can pick the tool and the arguments.
- Auth is fixed to `.env`, not flags.
- It is not a "lightweight install" — the CLI *is* the server's code. What's light is
  the **runtime / protocol** side (no daemon, no LLM).

## Using it alongside a coding agent (Claude Code, etc.)

If you fetch data with the CLI **and** want an agent to interpret it, do not hand it the
raw JSON alone. Do one of:

1. **Route interpretation through the MCP / methodology layer** — fetch over the CLI, but
   judge with Claude over MCP (where `instructions` is auto-injected).
2. **Supply the methodology yourself** — before letting the agent use the CLI, have it
   read your `training-knowledge` (athlete config, methodology rules, plan) and the
   `instructions.ts` context, then analyze.

> The point: **the CLI is a data tap, not an analyst.** The analyst has to be a Claude
> that carries the methodology. The more specialized the sport (ultra, etc.), the more
> that methodology guidance decides whether the conclusion is correct.
