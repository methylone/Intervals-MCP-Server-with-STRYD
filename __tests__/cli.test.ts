// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
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
