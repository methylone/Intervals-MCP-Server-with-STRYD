# Roadmap

This is a personal project shared as-is — there is no fixed timeline and the
direction may change.

## Shipped

The two items that were "planned next" are now in the codebase:

- **CLI front-end** — the tools can be run directly from a shell via the
  `intervals-mcp` binary (`intervals-mcp list`, `intervals-mcp <tool> '<json>'`),
  not only over MCP. See [docs/CLI.md](docs/CLI.md).
- **Transport-agnostic decoupling** — tool definitions are now transport-free
  (`ToolDef`: a handler returns plain data; thin per-surface adapters render it for
  MCP and for the CLI). A single source of truth per tool, free of the MCP content
  envelope. See [ARCHITECTURE.md](ARCHITECTURE.md).

Distribution also landed: an npm package (`intervals-mcp-with-stryd`, `npx` one-line
setup) and an MCPB bundle for one-click Claude Desktop install with the API key held
in the OS keychain.

## Planned next

- **Structured-interval block boundaries.** Today `split_method: "km"` approximates
  workout structure, but short rests (under ~1 km / ~3 min) get absorbed into the
  surrounding splits. Investigate the Intervals.icu **LAP / Intervals API** to detect
  real block boundaries automatically, so structured workouts (e.g. 2×20 min tempo)
  split on their actual blocks rather than on distance.
- **Methodology notes in the server instructions.** Fold a couple of confirmed field
  lessons into `instructions.ts` — the Stryd `average_temp` bias (foot-mounted sensor
  reads several °C above ambient; relative comparison still valid) and the constraint
  that halves-based decoupling is meaningless on structured intervals.

No fixed dates. Forks are welcome to take any of this further.
