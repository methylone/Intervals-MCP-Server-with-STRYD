English | [日本語](SECURITY.ja.md)

# Security

## Transport: HTTP mode is not internet-safe

The Streamable HTTP transport (`MCP_TRANSPORT=http`) **has no application-layer
authentication** and binds to `0.0.0.0` (all network interfaces). Anyone who can
reach the port can call every tool with your Intervals.icu credentials.

- **Default and recommended for personal use: `stdio`.** The client launches the
  server as a local subprocess; nothing listens on the network.
- If you need HTTP (multiple clients, a always-on server), restrict access at the
  **network layer**: run it only inside a VPN such as
  [Tailscale](https://tailscale.com), or behind a firewall that limits the port to
  trusted hosts.
- **Never expose the HTTP endpoint to the public internet.** There is no auth, rate
  limiting, or per-user isolation.

## Credentials

- Your Intervals.icu API key and athlete ID live **only in `.env`**, which is
  gitignored. Never commit them.
- **MCPB install (Claude Desktop):** the API key is declared `sensitive` in the bundle
  manifest, so Claude Desktop stores it in your **OS keychain** rather than a plaintext
  config file. This only changes where the key is *stored* — the server's attack surface
  (no app-layer auth on HTTP, etc.) is unchanged.
- `.env.example` contains placeholders only — copy it to `.env` and fill in real
  values locally.
- When pasting client config or asking an AI assistant to set things up, avoid
  putting real API keys into shared or logged conversations.
- If a key is ever exposed, **rotate it** in Intervals.icu (*Settings → Developer*).

## Reporting a vulnerability

Please report security issues via **GitHub Issues** on this repository. Describe the
problem and reproduction steps; do not include real API keys or personal data in the
report.
