// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

function captureIo() {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

describe("cli", () => {
  it("lists registered tool names directly from the TOOLS registry", async () => {
    const capture = captureIo();

    const code = await main(["list"], capture.io);

    expect(code).toBe(0);
    expect(capture.stderr).toBe("");
    const tools = JSON.parse(capture.stdout) as Array<{
      name: string;
      title: string;
      description: string;
    }>;
    expect(tools).toHaveLength(17);
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_activities");
    expect(names).toContain("get_current_pmc");
    // Descriptions are part of the catalog so it is browsable without creds.
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("emits pretty JSON by default and compact JSON with --raw for list", async () => {
    const pretty = captureIo();
    expect(await main(["list"], pretty.io)).toBe(0);
    expect(pretty.stdout).toContain("[\n"); // indented

    const raw = captureIo();
    expect(await main(["list", "--raw"], raw.io)).toBe(0);
    expect(raw.stdout.trimEnd()).not.toContain("\n"); // single line
  });

  it("prints usage to stderr and exits 2 for --help", async () => {
    const capture = captureIo();

    const code = await main(["--help"], capture.io);

    expect(code).toBe(2);
    expect(capture.stdout).toBe("");
    expect(capture.stderr).toContain("Usage:");
  });

  it("prints usage to stderr and exits 2 for unknown options", async () => {
    const capture = captureIo();

    const code = await main(["--bogus"], capture.io);

    expect(code).toBe(2);
    expect(capture.stdout).toBe("");
    expect(capture.stderr).toContain("Unknown option: --bogus");
  });

  it("prints usage to stderr and exits 2 for invalid json_args", async () => {
    const capture = captureIo();

    const code = await main(["get_current_pmc", "{bad"], capture.io);

    expect(code).toBe(2);
    expect(capture.stdout).toBe("");
    expect(capture.stderr).toContain("json_args must be valid JSON.");
  });

  it("exits 1 with a stderr diagnostic for an unknown tool name", async () => {
    const capture = captureIo();

    const code = await main(["bogus_tool", "{}"], capture.io);

    expect(code).toBe(1);
    expect(capture.stdout).toBe("");
    expect(capture.stderr).toContain("Tool not found: bogus_tool");
  });
});

// §3.3 regression guard (v0.6.0): building the tool registry and listing it must
// NOT trigger loadConfig — `cli list` has to work with NO credentials present,
// even though get_activities now references config_.lbssField (lazily, inside its
// handler). A fresh module graph with the creds stripped proves nothing reads
// config_ at import/enumeration time.
describe("cli list — credential-free", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("lists all 17 tools with no INTERVALS_* env set", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    try {
      delete process.env.INTERVALS_API_KEY;
      delete process.env.INTERVALS_ATHLETE_ID;
      delete process.env.LBSS_FIELD;

      const { main: freshMain } = await import("../src/cli.js");

      let stdout = "";
      let stderr = "";
      const code = await freshMain(["list"], {
        stdout: (t: string) => { stdout += t; },
        stderr: (t: string) => { stderr += t; },
      });

      expect(code).toBe(0);
      expect(stderr).toBe("");
      const tools = JSON.parse(stdout) as Array<{ name: string }>;
      expect(tools).toHaveLength(17);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});
