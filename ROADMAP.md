# Roadmap

This is a personal project shared as-is — there is no fixed timeline and the
direction may change. The two items below are the planned next steps, **in order**.

## 1. CLI front-end (simple first)

Add a command-line entry point so the tools can be invoked directly from a shell,
not only over MCP. A single multi-call binary would dispatch on `argv`:

- `intervals serve` (or `--http`) — run as the MCP server / HTTP daemon (today's behavior)
- `intervals <tool> --<arg> …` — run one tool and print its result
- `intervals help` — list the available tools and their arguments

The first cut is deliberately a **thin shim** over the existing tool registry. Its
purpose is to validate that a CLI is genuinely useful as a *second consumer* of the
same tools — before any tool code is restructured.

## 2. Transport-agnostic decoupling

Today each tool handler returns the MCP content envelope
(`{ content: [{ type: "text", text }] }`), so the tool logic is shaped by the MCP
protocol. The durable computation layer (the `utils/`, the Stryd LBSS calculator, and
the Intervals.icu client) is already transport-independent — only the thin handler
glue is coupled.

The plan is to **decouple tool definitions from any single transport**: handlers
return plain data, and small per-surface adapters render that data for MCP, for the
CLI, and for whatever comes next. The payoff is a single source of truth per tool
(fewer "fixed it in one place but not the other" bugs) and the freedom to follow the
protocol-of-the-month without rewriting domain logic — MCP is still young, and this
project already migrated stdio → Streamable HTTP once.

**Sequence:** ship the CLI shim (1) to prove the second-consumer value, then do the
decoupling (2) as the real maintainability fix.
