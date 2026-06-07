#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Release-time PII grep for the .mcpb bundle (#14.6).
 *
 * The .mcpb is a zip of manifest.json + build/ + package.json + README + LICENSE
 * + node_modules. It is NOT scanned by the test suite (packing it is slow and
 * pulls in the mcpb toolchain), so this script is the release gate. Run it after
 * `mcpb pack`, before attaching the bundle to a GitHub Release.
 *
 * Usage:
 *   node scripts/check-mcpb-pii.mjs [path/to/bundle.mcpb]
 * With no argument it picks the single *.mcpb in the current directory.
 *
 * Checks (exit 1 on any finding):
 *   - own files (everything except node_modules): no absolute home paths outside
 *     the placeholder allowlist, no email-like string outside the allowlist
 *     (GitHub noreply / RFC 2606 examples).
 *   - entire bundle (incl. node_modules): none of the `.pii-forbidden` literals
 *     (the maintainer's real name/email/home path). Third-party dependency
 *     author emails are expected and are only excluded from the own-files scan,
 *     never matched against the deny-list.
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirnameOf(import.meta.url), "..");

function dirnameOf(url) {
  const p = fileURLToPath(url);
  return p.slice(0, p.lastIndexOf("/"));
}

// Same vocabulary as __tests__/helpers/pii.ts. Keep duplicated because this
// release script is plain JS and should run without compiling test helpers.
const HOME_PATH_RE = /(?:\/Users\/[^\s"'`<>)]*|\/home\/[^\s"'`<>)]*|[A-Za-z]:\\Users\\[^\s"'`<>)]*)/g;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
function isAllowedEmail(email) {
  const domain = email.split("@").pop()?.toLowerCase() ?? "";
  return (
    domain === "users.noreply.github.com" ||
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain === "test" ||
    domain.endsWith(".test") ||
    domain === "invalid" ||
    domain.endsWith(".invalid") ||
    domain === "example" ||
    domain.endsWith(".example")
  );
}

function isAllowedHomePath(homePath) {
  return (
    /^\/Users\/you(?:\/|$)/.test(homePath) ||
    /^\/home\/you(?:\/|$)/.test(homePath) ||
    /^[A-Za-z]:\\Users\\you(?:\\|$)/.test(homePath)
  );
}

function findBundle() {
  const arg = process.argv[2];
  if (arg) return arg;
  const here = readdirSync(process.cwd()).filter((f) => f.endsWith(".mcpb"));
  if (here.length === 1) return join(process.cwd(), here[0]);
  console.error(
    here.length === 0
      ? "No .mcpb found in current directory. Pass the path explicitly."
      : `Multiple .mcpb found (${here.join(", ")}). Pass the path explicitly.`,
  );
  process.exit(2);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function readUtf8(file) {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return ""; // unreadable/binary — skip
  }
}

function loadForbidden() {
  const f = join(repoRoot, ".pii-forbidden");
  if (!existsSync(f)) return null;
  return readFileSync(f, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

const bundle = findBundle();
if (!existsSync(bundle)) {
  console.error(`Bundle not found: ${bundle}`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "mcpb-pii-"));
const findings = [];
try {
  execFileSync("unzip", ["-o", "-q", bundle, "-d", work]);
  const all = listFiles(work);
  const forbidden = loadForbidden();

  if (forbidden === null) {
    console.warn(
      "WARNING: .pii-forbidden not found — running structural checks only. " +
        "Create it (gitignored) with the maintainer's real name/email/home path " +
        "to enable the deep deny-list check.",
    );
  }

  for (const file of all) {
    const rel = relative(work, file);
    const inNodeModules = rel.split("/").includes("node_modules");
    const content = readUtf8(file);

    // Deny-list applies everywhere (our PII must not be in any bundled file).
    if (forbidden) {
      for (const needle of forbidden) {
        if (content.includes(needle)) findings.push(`[deny-list] ${rel}`);
      }
    }

    // Home paths + non-allowlist emails: own files only (skip dependencies).
    if (!inNodeModules) {
      const homes = (content.match(HOME_PATH_RE) ?? []).filter((p) => !isAllowedHomePath(p));
      if (homes.length) findings.push(`[home-path] ${rel}: ${[...new Set(homes)].join(", ")}`);
      const emails = (content.match(EMAIL_RE) ?? []).filter((e) => !isAllowedEmail(e));
      if (emails.length) findings.push(`[email] ${rel}: ${[...new Set(emails)].join(", ")}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (findings.length > 0) {
  console.error(`PII check FAILED for ${bundle}:`);
  for (const f of [...new Set(findings)]) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PII check passed: ${bundle} (no home paths, no unexpected emails, no deny-list hits).`);
