// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Version single-source guard (v0.5.0 §5).
 *
 * serverInfo.version is now read from package.json via getPackageVersion(), so
 * it can't drift from the published version again. These tests pin the two
 * remaining places a version string lives in the repo — package.json and
 * manifest.json — to the same value, catching the manifest/package drift that
 * a renumbered release would otherwise hide.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPackageVersion } from "../src/version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function readVersion(name: string): string {
  const data = JSON.parse(readFileSync(join(repoRoot, name), "utf-8")) as { version?: string };
  return data.version ?? "";
}

describe("version single-source", () => {
  it("getPackageVersion() returns package.json's version (not a stale literal)", () => {
    expect(getPackageVersion()).toBe(readVersion("package.json"));
    expect(getPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("manifest.json version matches package.json version", () => {
    expect(readVersion("manifest.json")).toBe(readVersion("package.json"));
  });
});
