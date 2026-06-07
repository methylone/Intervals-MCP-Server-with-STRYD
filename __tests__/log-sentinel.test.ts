// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PII guard — log sentinel test (#14.1 / #14.2).
 *
 * Drives the credential-bearing log paths (the MCP adapter tool lifecycle, the
 * on-disk cache, and config validation) with *sentinel* credentials and asserts
 * those sentinels never reach stderr. Two distinct properties:
 *
 *   (A) Credentials (API key / athlete ID) must never appear in ANY stderr sink.
 *   (B) An upstream Intervals.icu response body must never persist to a server
 *       log line — but it MAY remain in the consumer-facing error (the MCP
 *       isError text / the CLI's stderr), which is the point of the redaction
 *       in src/adapters/mcp.ts + IntervalsApiError.
 *
 * Coverage of every console.error site is enforced separately by
 * console-error-allowlist.test.ts (a new site = red = forces a review of
 * whether this sentinel test must grow).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sentinel values: searchable, obviously fake, and never real. The whole test
// exists to prove these strings do not leak to stderr.
const SENTINEL_KEY = "PII_SENTINEL_KEY_x9q7wZ_do_not_log";
const SENTINEL_ATHLETE = "i98765432";
const SENTINEL_BODY = "PII_SENTINEL_BODY_athlete_private_42";

// Configure sentinel credentials before any module reads config_. config_ is a
// lazy, memoized Proxy, so setting these after the (hoisted) imports is safe as
// long as nothing has accessed config_ yet — and nothing does at import time.
process.env.INTERVALS_API_KEY = SENTINEL_KEY;
process.env.INTERVALS_ATHLETE_ID = SENTINEL_ATHLETE;

import { registerToolDef } from "../src/adapters/mcp.js";
import { IntervalsApiError } from "../src/core/intervals-client.js";
import { cacheClear } from "../src/core/cache.js";
import { getActivitiesTool } from "../src/core/tools/get-activities.js";

type McpToolHandler = (
  raw: unknown,
  extra?: { signal?: AbortSignal; requestId?: string | number },
) => Promise<unknown>;

/** Register a ToolDef on a fake server and return the captured MCP handler. */
function captureHandler(): McpToolHandler {
  let handler: McpToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, h: McpToolHandler) => {
      handler = h;
    },
  } as unknown as Parameters<typeof registerToolDef>[0];
  registerToolDef(fakeServer, getActivitiesTool);
  if (!handler) throw new Error("registerToolDef did not register a handler");
  return handler;
}

function serialize(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

let captured: string[];
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = [];
  errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push(args.map(serialize).join(" "));
  });
});

afterEach(() => {
  errSpy.mockRestore();
  vi.unstubAllGlobals();
});

function stderrText(): string {
  return captured.join("\n");
}

/** Assert no sentinel credential leaked, with a readable failure message. */
function expectNoCredentialLeak(): void {
  const text = stderrText();
  expect(text, "API key leaked to stderr").not.toContain(SENTINEL_KEY);
  expect(text, "athlete ID leaked to stderr").not.toContain(SENTINEL_ATHLETE);
}

function okJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const ARGS = { oldest: "2026-01-01", newest: "2026-01-07" };

describe("log sentinel — credentials never reach stderr", () => {
  it("does not log credentials on a successful tool call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson([])));
    const handler = captureHandler();

    await handler(ARGS, { requestId: 1 });

    // The adapter logs lifecycle (start/end) — but no credentials.
    expect(stderrText()).toContain("tool start");
    expect(stderrText()).toContain("tool end");
    expectNoCredentialLeak();
    expect(stderrText()).not.toContain(SENTINEL_BODY);
  });

  it("does not log credentials when the call is cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson([])));
    const handler = captureHandler();
    const controller = new AbortController();
    controller.abort("client cancelled");

    await handler(ARGS, { requestId: 2, signal: controller.signal }).catch(() => {});

    expectNoCredentialLeak();
  });

  it("does not log credentials from the cache 'refuse to clear' path", async () => {
    // activityId with a path separator trips the confinement guard (cache.ts),
    // which console.error's the offending value. No credential should appear.
    await cacheClear("../escape");
    expect(stderrText()).toContain("Refusing to clear");
    expectNoCredentialLeak();
  });
});

describe("log sentinel — upstream response body is redacted from logs (#14.2)", () => {
  it("keeps the body in the thrown error but not in the server log line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(SENTINEL_BODY, { status: 500, statusText: "Internal Server Error" }),
      ),
    );
    const handler = captureHandler();

    let thrown: unknown;
    try {
      await handler(ARGS, { requestId: 3 });
    } catch (err) {
      thrown = err;
    }

    // Consumer-facing error (becomes the MCP isError text) keeps the body —
    // the diagnostic detail is valuable to the LLM/human.
    expect(thrown).toBeInstanceOf(IntervalsApiError);
    expect((thrown as Error).message).toContain(SENTINEL_BODY);

    // Persistent server log: status summary present, body absent.
    expect(stderrText()).toContain("tool error");
    expect(stderrText()).toContain("Intervals.icu API error: 500");
    expect(stderrText(), "upstream body leaked into the server log").not.toContain(
      SENTINEL_BODY,
    );
    expectNoCredentialLeak();
  });
});

describe("log sentinel — config validation error never echoes the API key", () => {
  it("omits the key from the message index.ts logs on a bad config", async () => {
    // index.ts:51 logs exactly `err.message` from loadConfig on a bad env.
    // Use a fresh module so memoization from the sentinel-valid config above
    // does not mask the validation failure.
    vi.resetModules();
    const saved = { ...process.env };
    try {
      process.env.INTERVALS_API_KEY = SENTINEL_KEY;
      process.env.INTERVALS_ATHLETE_ID = SENTINEL_ATHLETE;
      process.env.ATHLETE_TIMEZONE = "Not/ARealZone"; // forces a validation throw
      const { loadConfig } = await import("../src/config.js");

      let msg = "";
      try {
        loadConfig();
      } catch (err) {
        msg = err instanceof Error ? err.message : String(err);
      }
      expect(msg, "config error should have been thrown").not.toBe("");
      expect(msg, "API key leaked via config error message").not.toContain(SENTINEL_KEY);
    } finally {
      // Restore env and module graph for any later test.
      for (const k of Object.keys(process.env)) {
        if (!(k in saved)) delete process.env[k];
      }
      Object.assign(process.env, saved);
      vi.resetModules();
    }
  });
});
