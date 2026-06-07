#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stage 2 Phase 1 cutover: the CLI dispatches directly against the
// transport-free TOOLS registry via runToolDef. It no longer imports
// index.ts / createServer, so the CLI is free of the MCP/express composition
// root (verifiable: `node build/cli.js` does not transitively import express).
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { getActiveTools } from "./tool-registry.js";
import { runToolDef } from "./adapters/cli.js";

type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

type ParsedCliArgs =
  | { kind: "list"; raw: boolean }
  | { kind: "tool"; raw: boolean; toolName: string; toolArgs: Record<string, unknown> }
  | { kind: "usage"; message?: string };

const defaultIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

function usage(): string {
  return [
    "Usage:",
    "  cli <tool_name> [json_args] [--raw]",
    "  cli list [--raw]    list tools with name, title and description",
    "  cli --help | -h",
    "",
    "json_args must be a JSON object string and defaults to {}.",
    "list and --help need no credentials; running a tool requires a configured .env.",
  ].join("\n");
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positional: string[] = [];
  let raw = false;

  for (const arg of argv) {
    if (arg === "--raw") {
      raw = true;
    } else if (arg === "--help" || arg === "-h") {
      return { kind: "usage" };
    } else if (arg.startsWith("-")) {
      return { kind: "usage", message: `Unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    return { kind: "usage", message: "Missing tool name." };
  }

  const [command, jsonArgs, ...extra] = positional;
  if (extra.length > 0) {
    return { kind: "usage", message: "Too many positional arguments." };
  }

  if (command === "list") {
    if (jsonArgs !== undefined) {
      return { kind: "usage", message: "list does not accept json_args." };
    }
    return { kind: "list", raw };
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(jsonArgs ?? "{}");
  } catch {
    return { kind: "usage", message: "json_args must be valid JSON." };
  }

  if (parsedArgs === null || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
    return { kind: "usage", message: "json_args must be a JSON object." };
  }

  return {
    kind: "tool",
    raw,
    toolName: command,
    toolArgs: parsedArgs as Record<string, unknown>,
  };
}

function writeMessage(write: (text: string) => void, text: string): void {
  write(text.endsWith("\n") ? text : `${text}\n`);
}

function writeUsage(io: CliIo, message?: string): void {
  const prefix = message ? `${message}\n\n` : "";
  writeMessage(io.stderr, `${prefix}${usage()}`);
}

function formatJsonOutput(value: unknown, raw: boolean): string {
  return JSON.stringify(value, null, raw ? 0 : 2);
}

export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (parsed.kind === "usage") {
    writeUsage(io, parsed.message);
    return 2;
  }

  if (parsed.kind === "list") {
    // Names + descriptions so the catalog is browsable without credentials
    // (the registry is transport-free and needs no auth to enumerate).
    // getActiveTools() applies READ_ONLY identically to the MCP server, so the
    // CLI lists exactly the tools the server would register.
    const tools = getActiveTools().map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
    }));
    writeMessage(io.stdout, formatJsonOutput(tools, parsed.raw));
    return 0;
  }

  // parsed.kind === "tool" — only active tools are runnable (READ_ONLY hides the
  // account-writing tools, so they report "not found" rather than executing).
  const tool = getActiveTools().find((t) => t.name === parsed.toolName);
  if (!tool) {
    writeMessage(io.stderr, `Tool not found: ${parsed.toolName}`);
    return 1;
  }

  try {
    // runToolDef validates args (applying Zod defaults) and returns a JSON
    // string. A validation error or a handler hard-failure throws → exit 1.
    const output = await runToolDef(tool, parsed.toolArgs, { raw: parsed.raw });
    writeMessage(io.stdout, output);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeMessage(io.stderr, message);
    return 1;
  }
}

// Resolve argv[1] through realpath so "run as main" is still detected when the
// CLI is launched via an npm/npx bin **symlink**: argv[1] is the symlink path while
// import.meta.url is the real module path, so a raw compare would be false and the
// CLI would silently do nothing.
const entryPath = process.argv[1];
const isMain = !!entryPath && import.meta.url === pathToFileURL(realpathSync(entryPath)).href;

if (isMain) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
