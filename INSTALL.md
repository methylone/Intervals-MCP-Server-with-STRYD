English | [日本語](INSTALL.ja.md)

# Installation & Setup

This guide takes you from zero to a working Intervals.icu MCP server connected to
your AI client. It is explicit enough that you can also paste this repository's URL
into an AI assistant and have it do the setup for you (see
[Let an AI install it](#let-an-ai-install-it)).

## Prerequisites

- **Node.js >= 20.12** (the server uses the built-in `--env-file` flag; the test
  script uses `--env-file-if-exists`, added in 20.12). Check with `node --version`.
- **An Intervals.icu account** with an **API key**: on intervals.icu go to
  *Settings → Developer* and copy your API key.
- **Your athlete ID**: visible in the Intervals.icu URL when viewing your own
  calendar/profile (a short string like `i12345678`). You can also set the athlete
  ID to `0`, which means "the owner of this API key".
- **(Optional) Stryd extension.** The `get_current_pmc`, `get_weekly_summary`, and
  `get_phase_summary` tools use Stryd load metrics (LBSS / ILR). These require a
  Stryd power meter **and** three Intervals.icu custom fields — see
  [Setting up the Stryd custom fields](#setting-up-the-stryd-custom-fields-optional).
  **The core tools work without Stryd** — the extension simply adds power-based PMC on top.
- **(Optional) Weather metric.** The `average_feels_like` value used by
  `search_similar_activities` comes from Open-Meteo enrichment in Intervals.icu;
  activities without weather are excluded when a temperature filter is set.

## Install via MCPB (Claude Desktop, easiest)

Claude Desktop can install this server from a single `.mcpb` bundle — no clone, no Node
setup. Download `intervals-mcp-with-stryd.mcpb` from the
[latest release](https://github.com/methylone/Intervals-MCP-Server-with-STRYD/releases),
double-click it, and Claude Desktop will prompt for three values:

- **Athlete ID** — `i…` (or `0`, the API key owner).
- **API key** — from Intervals.icu *Settings → Developer*. It is marked sensitive and
  stored in your **OS keychain**, not in a plaintext file.
- **Timezone** — IANA name (optional; default `UTC`).

For the **Stryd** tools to return data you still need the custom fields in
[Setting up the Stryd custom fields](#setting-up-the-stryd-custom-fields-optional); the
server install itself needs nothing else.

## Install via npx

If your client launches MCP servers by command (Claude Desktop, Codex, …), run the
published npm package directly — no clone, no build:

```json
{
  "mcpServers": {
    "intervals": {
      "command": "npx",
      "args": ["-y", "intervals-mcp-with-stryd"],
      "env": {
        "INTERVALS_ATHLETE_ID": "i0000000",
        "INTERVALS_API_KEY": "your-api-key",
        "ATHLETE_TIMEZONE": "Asia/Tokyo",
        "CACHE_DIR": "/absolute/path/to/intervals-cache"
      }
    }
  }
}
```

`CACHE_DIR` is optional but recommended here. The on-disk stream cache resolves to a
path under the server's install location; under `npx` that is the **volatile npx package
cache**, so point `CACHE_DIR` at a stable absolute directory if you want the cache to
persist across runs. (Only activity *streams* are cached; PMC / wellness / activities are
always fetched live.) The npm package also installs an `intervals-mcp` CLI on your
`PATH` — see [docs/CLI.md](docs/CLI.md).

For the Stryd extension, add the custom fields in
[Setting up the Stryd custom fields](#setting-up-the-stryd-custom-fields-optional).

## Install from source (development / HTTP / Docker)

```bash
# 1. Clone
git clone https://github.com/methylone/Intervals-MCP-Server-with-STRYD.git intervals-mcp-server
cd intervals-mcp-server

# 2. Install dependencies
npm install

# 3. Create your .env from the template and fill in your values
cp .env.example .env
#   then edit .env:
#     INTERVALS_API_KEY=...        (from Settings > Developer)
#     INTERVALS_ATHLETE_ID=i12345678  (or 0)
#     ATHLETE_TIMEZONE=Asia/Tokyo  (optional; default UTC)

# 4. Build
npm run build
```

`npm run build` compiles TypeScript into `build/`. The server entry point is then
`build/index.js`.

You can sanity-check the build with `npm test` (runs the unit test suite) and, for
stdio, `npm run dev` (runs from source via `tsx`).

### Optional settings

All optional variables are documented in `.env.example`. Two worth calling out:

- **`ATHLETE_TIMEZONE`** — IANA name (e.g. `Asia/Tokyo`); default `UTC`. Affects
  "today" and Mon–Sun week boundaries.
- **`CACHE_DIR`** — directory for the on-disk activity-stream cache. An **absolute
  path is recommended**, because the launch working directory differs across clients
  and hosts (Claude Desktop, Codex, Linux server) — a relative path would resolve to
  a different cache per client. If left unset it defaults to an absolute
  `<server install>/cache/streams`, resolved from the server's own location rather
  than the launch directory. See [ARCHITECTURE.md](ARCHITECTURE.md#caching) for when
  to flush it (FIT re-upload / elevation correction → `clear_cache` tool).
- **`CACHE_ENABLED`** — `true` (default) or `false`. Set `false` to bypass the
  stream cache entirely (always fetch fresh). You can also toggle this at runtime
  from the chat with the `set_cache_enabled` tool; the runtime state resets to this
  value on restart.
- **`READ_ONLY`** — `false` (default) or `true`. Set `true` to withhold the four
  calendar-writing tools (`create_events` / `update_event` / `delete_event` /
  `delete_events`); the server then cannot write to your Intervals.icu account.
  Local-only tools stay available. A local mitigation only — the API key still
  grants full access. (MCPB users: use the "Read-only mode" toggle in the extension
  config.)
- **`LBSS_FIELD`** / **`LBSS_FIELD_LEGACY`** / **`ILR_FIELD`** — the Intervals.icu
  custom-field codes the Stryd aggregation tools read (CamelCase, no underscore).
  Defaults: `StrydLBSSv2` / `StrydLBSSmod` / `StrydILR`. Configurable so a recalibrated
  or renamed field needs no code change; the LBSS tools also accept a per-call
  `lbss_field` override, and `include_legacy=true` reports `LBSS_FIELD_LEGACY` alongside.
  **v0.6.0 changed the LBSS default `StrydLBSSmod` → `StrydLBSSv2`** — if your account only
  has the community `StrydLBSSmod` field, either build `StrydLBSSv2` from the
  [field recipes](https://github.com/methylone/Intervals-MCP-Server-with-STRYD/wiki/LLM-Agent-Recipes)
  or set `LBSS_FIELD=StrydLBSSmod` to restore the previous behavior.

### Setting up the Stryd custom fields (optional)

The Stryd extension reads three Intervals.icu **custom activity fields**. These are
community-shared fields you add to your own account — they are not built in. To enable them:

1. In Intervals.icu, go to **Settings → Sports Settings → Run → Custom Fields →
   Activity fields**.
2. Use the search box to find and add each of these three fields:

   | Display name | Field code (read by this server) | Shared by |
   |---|---|---|
   | Stryd LBSS mod | `StrydLBSSmod` | miguell |
   | Stryd ILR | `StrydILR` | Knuefi |
   | Stryd ILR @Treshold | `StrydILRTreshold` | miguell |

   `StrydILR` / `StrydILRTreshold` add the Impact Loading Rate metrics. The field codes —
   **including the `Treshold` spelling** — must match exactly; that is the real field name.

   These are the community-shared fields. Note the LBSS-based PMC now defaults to
   **`StrydLBSSv2`** (a Stryd-faithful recalibration, env `LBSS_FIELD`), which is not in
   the community search box — build it from the
   [field recipes](https://github.com/methylone/Intervals-MCP-Server-with-STRYD/wiki/LLM-Agent-Recipes),
   or set `LBSS_FIELD=StrydLBSSmod` to keep using the community `StrydLBSSmod` field above.

3. Once added, these values are copied onto **new Run activities**, so `get_current_pmc`,
   `get_weekly_summary`, `get_phase_summary`, and the ILR fields in `get_activity_detail`
   / `search_similar_activities` will have data to work with.

**Historical activities.** New activities get these fields automatically. Stryd LBSS/ILR
data is only available from around **November 2025** onward, so older activities won't have
it regardless; for activities within that range you can backfill the values by re-processing
them in Intervals.icu.

> `Stryd ILR @Treshold` additionally relies on an "ILR@CP Calculator" custom field to be set
> correctly — see that field's own description in Intervals.icu.

## Connecting a client

Use absolute paths in client configs. Replace `/absolute/path/to/intervals-mcp-server`
with your actual checkout path, and use your own credentials.

### Claude Desktop — stdio (recommended)

Edit your `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "intervals": {
      "command": "node",
      "args": ["/absolute/path/to/intervals-mcp-server/build/index.js"],
      "env": {
        "INTERVALS_API_KEY": "your_api_key_here",
        "INTERVALS_ATHLETE_ID": "i12345678",
        "ATHLETE_TIMEZONE": "Asia/Tokyo"
      }
    }
  }
}
```

Restart Claude Desktop; the `intervals` tools should appear.

### Codex CLI — stdio

Codex reads MCP servers from its config file (e.g. `~/.codex/config.toml`). A
stdio entry looks like:

```toml
[mcp_servers.intervals]
command = "node"
args = ["/absolute/path/to/intervals-mcp-server/build/index.js"]
env = { INTERVALS_API_KEY = "your_api_key_here", INTERVALS_ATHLETE_ID = "i12345678", ATHLETE_TIMEZONE = "Asia/Tokyo" }
```

(Consult your client's current MCP documentation for the exact schema — the shape
above is representative of stdio MCP server configs.)

> **Codex STDIO gotcha.** Codex and Claude Desktop expose different config UIs for
> stdio MCP servers. In Codex, the command arguments must be entered as **separate
> values** — one entry per argument (as in the `args = [ … ]` array above). Pasting
> the whole argument list into a single field as one combined string does not work;
> Codex passes it as a single literal argument and the launch fails. This matters
> whenever `args` has more than one element (for example
> `["--env-file", ".env", "build/index.js"]`).

### HTTP mode (advanced — read SECURITY first)

> ⚠️ Streamable HTTP mode has **no application-layer authentication** and binds to
> `0.0.0.0`. Only run it inside a trusted network / VPN (e.g. Tailscale) and
> **never expose it to the public internet**. See [SECURITY.md](SECURITY.md).

Start the server in HTTP mode:

```bash
MCP_TRANSPORT=http node --env-file .env build/index.js          # default port 8080
MCP_TRANSPORT=http MCP_PORT=3000 node --env-file .env build/index.js
```

Claude Desktop does not connect to HTTP MCP servers directly; bridge it with
`mcp-remote`. `--allow-http` is required because the endpoint is not HTTPS:

```json
{
  "mcpServers": {
    "intervals": {
      "command": "npx",
      "args": ["mcp-remote", "http://<server-host-on-your-vpn>:8080/mcp", "--allow-http"]
    }
  }
}
```

To keep it running 24/7 on a server, run it under a process manager such as
`systemd` (a `simple` service that runs `node build/index.js` with
`Environment=MCP_TRANSPORT=http` and an `EnvironmentFile` pointing at your `.env`),
or use Docker (below).

### Run with Docker (HTTP mode)

A `Dockerfile` and `docker-compose.yml` are included. The container runs in HTTP
mode, so the same SECURITY caveats apply — keep it on a trusted network and never
expose it to the public internet.

```bash
cp .env.example .env        # fill in API key, athlete ID, timezone
docker compose up -d --build
curl http://127.0.0.1:8080/health   # -> {"status":"ok",...}
```

The image is a multi-stage Node 22 Alpine build: it runs as a non-root user, ships
a `/health` HEALTHCHECK, and contains only production dependencies plus the compiled
`build/`. Secrets are read from `.env` via compose `env_file`; the stream cache
lives in the named volume `intervals-cache`. The compose `environment:` block forces
`CACHE_DIR=/data/cache/streams`, so a host-oriented `CACHE_DIR` in your `.env` is
safely overridden inside the container.

Without compose:

```bash
docker build -t intervals-mcp .
docker run -d --name intervals-mcp -p 8080:8080 \
  --env-file .env -e MCP_TRANSPORT=http -e CACHE_DIR=/data/cache/streams \
  -v intervals-cache:/data/cache/streams intervals-mcp
```

Bridge it to your client (e.g. `mcp-remote`) exactly as in HTTP mode above.

## Let an AI install it

Because this repository is self-describing, you can delegate setup:

1. Give your AI assistant (Claude / Codex) this repository's URL and ask it to read
   `README.md`, this `INSTALL.md`, and `ARCHITECTURE.md`.
2. Ask it to clone, run `npm install`, create `.env` from `.env.example`, and
   `npm run build`. Provide your API key and athlete ID when it asks (don't paste
   secrets into a shared/logged chat you don't control).
3. Ask it to emit the client config block for your client (Claude Desktop / Codex)
   with your absolute path filled in.
