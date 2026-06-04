English | [日本語](README.ja.md)

# Intervals.icu MCP Server

A Model Context Protocol (MCP) server that gives an AI client (Claude Desktop,
Codex, etc.) structured access to your [Intervals.icu](https://intervals.icu)
training data — plus deterministic, server-side computations that the AI should
not be guessing at (Performance Management Chart values, cardiac decoupling,
derived nutrition fields, and more).

It is designed to run **locally, for a single athlete (you)**. It is not a hosted,
multi-user service.

## What it does

- **Core (any Intervals.icu user):** list and inspect activities, wellness data,
  events / planned workouts (read + create / update / delete), athlete summaries,
  and stream-level analysis (splits, cardiac decoupling, pacing).
- **Stryd extension (power-meter users):** a second Performance Management Chart
  computed server-side from a lower-body load metric (LBSS) via EMA, alongside
  Intervals.icu's built-in RSS-based PMC; weekly and phase-level load trends.

The server only provides **data and math**. It does **not** decide how you should
train — that interpretation comes from a knowledge file *you* write and load into
your AI client. See [`training-knowledge-template/`](training-knowledge-template/).

## Quick start

Requirements: Node.js ≥ 20.12, an Intervals.icu account and API key. The Stryd
extension additionally needs a Stryd power meter and the relevant Intervals.icu
custom fields. Full steps: [INSTALL.md](INSTALL.md).

```bash
git clone <repo-url>
cd intervals-mcp-server
npm install
cp .env.example .env      # then fill in your API key, athlete ID, timezone
npm run build
```

Then point Claude Desktop (or Codex) at `build/index.js` over stdio — see
[INSTALL.md](INSTALL.md) for the exact config block. New to this? Hand the repo URL
to your AI client and ask it to walk you through installation using the README and
INSTALL.md.

## Documentation

- [INSTALL.md](INSTALL.md) — prerequisites and client setup
- [ARCHITECTURE.md](ARCHITECTURE.md) — code layout and how to extend it
- [SECURITY.md](SECURITY.md) — **read before using HTTP mode**
- [`training-knowledge-template/`](training-knowledge-template/) — build your own
  analysis knowledge for your AI client

## Security

The HTTP transport has **no application-layer authentication**. Run the server
locally over stdio for personal use, and never expose HTTP mode to the public
internet. See [SECURITY.md](SECURITY.md).

## Contributing

Forks are welcome — take it and make it yours. Pull requests are not actively
maintained, so please fork freely rather than expecting timely reviews.

## License

[AGPL-3.0-or-later](LICENSE). In short: you're free to use, modify, and run this,
including commercially — but if you distribute it or run a modified version as a
network service, you must release your source under the same license. It cannot be
turned into a closed, proprietary product.
