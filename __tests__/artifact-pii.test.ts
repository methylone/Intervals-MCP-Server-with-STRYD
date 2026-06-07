// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PII guard — npm tarball artifact (#14.5).
 *
 * Packs the actual publishable tarball (`npm pack`) and scans every shipped
 * file for leaks that the per-source checks can't see (e.g. an absolute home
 * path baked into a build artifact):
 *   (a) absolute home paths outside the placeholder allowlist
 *   (b) email-like strings outside the allowlist (GitHub noreply / RFC 2606 examples)
 *   (c) optional `.pii-forbidden` literals (deep check; skipped when absent)
 *
 * Design rule (strict): NO real name/email literal lives in this file. The
 * maintainer's real PII lives only in the gitignored, EXCLUDE'd `.pii-forbidden`
 * deny-list (see __tests__/helpers/pii.ts), so the public test code is never a
 * leak source itself.
 *
 * Note: the .mcpb bundle is scanned by scripts/check-mcpb-pii.mjs at release
 * time, not here — packing a .mcpb is slow and pulls in the mcpb toolchain.
 */
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  EMAIL_RE,
  isAllowedEmail,
  loadForbiddenStrings,
  unexpectedHomePaths,
} from "./helpers/pii.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

type ShippedFile = { path: string; content: string };

let workDir: string;
let files: ShippedFile[] = [];

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "intervals-pack-"));
  const out = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", workDir],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  const meta = JSON.parse(out) as Array<{ filename: string }>;
  const tarball = join(workDir, meta[0].filename);
  execFileSync("tar", ["-xzf", tarball, "-C", workDir]);

  const pkgDir = join(workDir, "package");
  files = listFilesRecursive(pkgDir).map((full) => ({
    path: relative(pkgDir, full).split("\\").join("/"),
    content: readFileSync(full, "utf-8"),
  }));
}, 120_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("npm tarball PII guard", () => {
  it("packs a non-empty set of files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains no absolute home paths (in contents or filenames)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const inPath = unexpectedHomePaths(f.path);
      if (inPath.length) offenders.push(`filename: ${f.path}`);
      const inContent = unexpectedHomePaths(f.content);
      if (inContent.length) offenders.push(`${f.path}: ${[...new Set(inContent)].join(", ")}`);
    }
    expect(offenders, `home path(s) found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("contains no email-like string outside the allowlist", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const emails = (f.content.match(EMAIL_RE) ?? []).filter((e) => !isAllowedEmail(e));
      if (emails.length) offenders.push(`${f.path}: ${[...new Set(emails)].join(", ")}`);
    }
    expect(offenders, `unexpected email(s):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("contains none of the .pii-forbidden literals (deep check, optional)", () => {
    const forbidden = loadForbiddenStrings(repoRoot);
    if (forbidden === null) return; // public clone / fresh checkout — skip
    expect(forbidden.length, ".pii-forbidden exists but is empty").toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      for (const needle of forbidden) {
        if (f.content.includes(needle)) offenders.push(f.path);
      }
    }
    expect([...new Set(offenders)], "forbidden literal(s) in tarball").toEqual([]);
  });
});

describe("PII allowlist rules", () => {
  it("allows only placeholder home paths with username you", () => {
    expect(unexpectedHomePaths("/Users/you/Intervals-MCP-Server/cache/streams")).toEqual([]);
    expect(unexpectedHomePaths("/home/you/Intervals-MCP-Server/cache/streams")).toEqual([]);
    expect(unexpectedHomePaths("C:\\Users\\you\\Intervals-MCP-Server\\cache\\streams")).toEqual([]);

    expect(unexpectedHomePaths("/Users/alice/project")).toEqual(["/Users/alice/project"]);
    expect(unexpectedHomePaths("/home/alice/project")).toEqual(["/home/alice/project"]);
    expect(unexpectedHomePaths("C:\\Users\\alice\\project")).toEqual(["C:\\Users\\alice\\project"]);
  });
});
