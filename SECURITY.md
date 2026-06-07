English | [日本語](SECURITY.ja.md)

# Security & privacy model

This server is a thin bridge between an MCP client (e.g. Claude Desktop) and the
Intervals.icu API. In 30 seconds: it talks to **one** remote host
(intervals.icu), it can **write only to your Intervals.icu calendar events**,
your API key is **never logged**, and it ships **no telemetry**. The rest of this
page states exactly what it does and does not do.

## The Claude Desktop "unverified" warning

When you install the `.mcpb` bundle, Claude Desktop warns that the extension is
**not verified by Anthropic** and **can read and write files on your computer**.
That warning is generic to every locally-installed extension — it describes what
a Node.js process *could* do, not what this one *does*. It cannot be removed
(only listing in Anthropic's official directory does that). What this server
actually touches is enumerated below; the source is AGPL and auditable.

## What it connects to

- **One remote host: `https://intervals.icu/api/v1`.** That is the only outbound
  network call in the code.
- **No telemetry, no analytics, no crash reporting.** Nothing is sent anywhere
  else.
- Weather / feels-like temperature shown by `search_similar_activities` is read
  from fields **Intervals.icu already stored on the activity** — the server does
  not call any weather provider itself.

## What it reads and what it writes

**Reads (Intervals.icu, read-only):** activities, activity streams, wellness,
athlete summaries, calendar events, HRV.

**Writes to your Intervals.icu account — calendar events only.** Exactly four
tools write, and only to *planned calendar events*:

- `create_events`, `update_event`, `delete_event`, `delete_events`

It **never** modifies or deletes your activities or wellness data. Deleting a
calendar event is irreversible, so the AI will normally confirm before doing so —
but you are in control of which tool calls you approve (see *First run* below).

**Writes locally:** only the on-disk stream cache (next section).

## Your Intervals.icu API key

- **Blast radius:** an Intervals.icu API key grants **full access to your
  account** (read *and* the calendar writes above). Intervals.icu does not offer
  scoped or read-only keys, so treat the key as a full-access credential.
- **Storage:** from source it lives only in `.env` (gitignored). With the `.mcpb`
  bundle it is declared `sensitive`, so Claude Desktop stores it in your **OS
  keychain**, not a plaintext config file.
- **It is never written to logs.** The key travels only in the HTTP
  `Authorization` header to intervals.icu.
- **Revoke / rotate** any time at Intervals.icu → *Settings → Developer*. Do this
  immediately if a key is ever exposed.

## The on-disk stream cache

- **What it stores:** per-activity time-series used for analysis — `time`,
  heart rate, power, velocity/pace, distance, grade, and cadence. It does **not**
  store GPS/location (`latlng`) or any personal identifier. Stream data is
  immutable, so there is no TTL.
- **Where:** `~/.intervals-mcp-with-stryd/cache/streams` for the `.mcpb` bundle;
  `<server install>/cache/streams` from source (override with `CACHE_DIR`).
- **When:** nothing is written at install. The folder is created lazily the first
  time you run a stream analysis. Typical size is a few KB–MB per activity.
- **Disable / clear:** set `CACHE_ENABLED=false` to never read or write it, call
  the `set_cache_enabled` / `clear_cache` tools at runtime, or just
  `rm -rf ~/.intervals-mcp-with-stryd/cache/streams`.

## Logs

- The server writes diagnostics to **stderr**, which the client captures. For
  Claude Desktop on macOS that is `~/Library/Logs/Claude/mcp*.log`.
- Logs contain tool names, request IDs, timings, and status codes — **not** your
  API key or athlete ID, and **not** the body of an Intervals.icu error response
  (an upstream error body is shown to the AI for context but is not persisted to
  the log). This is enforced by tests that run on every `npm test`.

## HTTP mode is not internet-safe

The optional Streamable HTTP transport (`MCP_TRANSPORT=http`) is opt-in and
**has no application-layer authentication**; it binds to `0.0.0.0` (all
interfaces). Anyone who can reach the port can call every tool with your
credentials.

- **Default and recommended: `stdio`.** The client launches the server as a local
  subprocess; nothing listens on the network. The `.mcpb` install uses this.
- If you need HTTP (multiple clients, an always-on server), restrict access at the
  **network layer** — run it only inside a VPN such as
  [Tailscale](https://tailscale.com), or behind a firewall limiting the port to
  trusted hosts.
- **Never expose the HTTP endpoint to the public internet.** There is no auth,
  rate limiting, or per-user isolation.

## First run in a chat

The first time the AI uses a tool, your MCP client asks you to approve it. You
can approve per-call or for the session. Approving a *read* tool only lets the AI
fetch data; the four calendar-write tools are where changes to your account
happen, so review those prompts.

## Verifying the build

- **Reproducible from source:** `git clone` → `npm ci` → `npm run build` →
  `npx @anthropic-ai/mcpb pack` reproduces the bundle. Nothing is fetched outside
  npm.
- **Checksum:** each GitHub Release publishes the `.mcpb` **SHA-256**. Verify your
  download with `shasum -a 256 intervals-mcp-with-stryd.mcpb` and compare.

## Updating

- **`.mcpb` (Claude Desktop):** there is no auto-update — re-download the newer
  bundle from GitHub Releases and reinstall.
- **`npx` / npm:** `npx intervals-mcp-with-stryd@latest` tracks the latest
  published version.

## Uninstalling

1. Remove the extension in Claude Desktop (Settings → Extensions), or
   `npm rm -g intervals-mcp-with-stryd` for a global npm install.
2. Delete the cache/config folder: `rm -rf ~/.intervals-mcp-with-stryd`.
3. Optionally revoke the API key at Intervals.icu → *Settings → Developer*.

## Platform support

Developed and verified on **macOS**. The code is cross-platform (Node ≥ 20.12)
and is expected to work on Windows and Linux, but those are not yet routinely
tested — feedback and issues from other platforms are welcome.

## Reporting a vulnerability

Please report security issues via **GitHub Issues** on this repository. Describe
the problem and reproduction steps; do not include real API keys or personal data
in the report.
