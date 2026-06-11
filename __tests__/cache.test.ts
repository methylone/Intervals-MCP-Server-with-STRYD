// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

// Mirrors the path-separator refine guarding clear_cache's activity_id input
// (src/core/tools/clear-cache.ts) — the boundary layer in front of cacheClear.
const clearCacheIdSchema = z
  .string()
  .min(1)
  .refine((s) => !/\s/.test(s) && !/[^\x20-\x7E]/.test(s), "name-like")
  .refine((s) => !/[/\\]/.test(s) && !s.includes(".."), "path-like");

describe("clear_cache activity_id validation", () => {
  it("accepts a normal activity ID", () => {
    expect(clearCacheIdSchema.safeParse("i12345678").success).toBe(true);
  });

  it("rejects forward-slash path separators", () => {
    expect(clearCacheIdSchema.safeParse("i123/i456").success).toBe(false);
  });

  it("rejects backslash path separators", () => {
    expect(clearCacheIdSchema.safeParse("i123\\i456").success).toBe(false);
  });

  it("rejects parent-directory traversal", () => {
    expect(clearCacheIdSchema.safeParse("..").success).toBe(false);
    expect(clearCacheIdSchema.safeParse("../secret").success).toBe(false);
  });
});

describe("cache", () => {
  let testDir: string;
  let cacheGet: typeof import("../src/core/cache.js").cacheGet;
  let cacheSet: typeof import("../src/core/cache.js").cacheSet;
  let cacheClear: typeof import("../src/core/cache.js").cacheClear;
  let setCacheEnabled: typeof import("../src/core/cache.js").setCacheEnabled;
  let isCacheEnabled: typeof import("../src/core/cache.js").isCacheEnabled;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "mcp-cache-test-"));
    process.env.CACHE_DIR = testDir;

    // Reset module cache to pick up new CACHE_DIR
    vi.resetModules();
    const mod = await import("../src/core/cache.js");
    cacheGet = mod.cacheGet;
    cacheSet = mod.cacheSet;
    cacheClear = mod.cacheClear;
    setCacheEnabled = mod.setCacheEnabled;
    isCacheEnabled = mod.isCacheEnabled;
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    delete process.env.CACHE_ENABLED; // only set by the env-default test
  });

  const MOCK_STREAMS = [
    { type: "time", data: [0, 1, 2, 3] },
    { type: "fixed_heartrate", data: [120, 121, 122, 123] },
  ];
  const MOCK_TYPES = ["time", "fixed_heartrate"];

  it("cache miss — returns null for uncached activity", async () => {
    const result = await cacheGet("i99999999");
    expect(result).toBeNull();
  });

  it("cache hit — returns stored data after cacheSet", async () => {
    await cacheSet("i12345678", MOCK_TYPES, MOCK_STREAMS);
    const result = await cacheGet("i12345678");
    expect(result).toEqual(MOCK_STREAMS);
  });

  it("cacheSet creates directory and writes a v2 envelope", async () => {
    await cacheSet("i12345678", MOCK_TYPES, MOCK_STREAMS);
    const raw = await readFile(join(testDir, "i12345678.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ v: 2, types: MOCK_TYPES, streams: MOCK_STREAMS });
  });

  it("cacheClear() — removes all cached activities and reports the count", async () => {
    await cacheSet("i11111111", MOCK_TYPES, MOCK_STREAMS);
    await cacheSet("i22222222", MOCK_TYPES, MOCK_STREAMS);

    const deleted = await cacheClear();
    expect(deleted).toBe(2);
    expect(await cacheGet("i11111111")).toBeNull();
    expect(await cacheGet("i22222222")).toBeNull();
  });

  it("cacheClear(id) — removes only the named activity", async () => {
    await cacheSet("i11111111", MOCK_TYPES, MOCK_STREAMS);
    await cacheSet("i22222222", MOCK_TYPES, MOCK_STREAMS);

    const deleted = await cacheClear("i11111111");
    expect(deleted).toBe(1);
    expect(await cacheGet("i11111111")).toBeNull();
    expect(await cacheGet("i22222222")).toEqual(MOCK_STREAMS);
  });

  it("cacheClear(id) — returns 0 for an activity that was never cached", async () => {
    const deleted = await cacheClear("i99999999");
    expect(deleted).toBe(0);
  });

  it("cacheClear() — returns 0 when the cache dir does not exist", async () => {
    await rm(testDir, { recursive: true, force: true });
    const deleted = await cacheClear();
    expect(deleted).toBe(0);
  });

  it("cacheClear(id) — refuses to delete outside the cache dir (path traversal)", async () => {
    // Sentinel lives one level above the cache dir, with a name unique to this
    // test run so parallel test files cannot collide on it in the shared tmpdir.
    const sentinelName = `${basename(testDir)}-sentinel`;
    const sentinelPath = join(testDir, "..", `${sentinelName}.json`);
    await writeFile(sentinelPath, "keep me");
    try {
      const deleted = await cacheClear(`../${sentinelName}`);
      expect(deleted).toBe(0);
      await expect(readFile(sentinelPath, "utf-8")).resolves.toBe("keep me");
    } finally {
      await rm(sentinelPath, { force: true });
    }
  });

  it("defaults to enabled when CACHE_ENABLED is unset", () => {
    expect(isCacheEnabled()).toBe(true);
  });

  it("setCacheEnabled(false) bypasses reads and writes; re-enabling restores access", async () => {
    await cacheSet("i11111111", MOCK_TYPES, MOCK_STREAMS); // written while enabled

    setCacheEnabled(false);
    expect(isCacheEnabled()).toBe(false);
    // existing file is ignored while disabled
    expect(await cacheGet("i11111111")).toBeNull();
    // writes are no-ops while disabled
    await cacheSet("i22222222", MOCK_TYPES, MOCK_STREAMS);

    setCacheEnabled(true);
    expect(await cacheGet("i22222222")).toBeNull(); // never persisted
    expect(await cacheGet("i11111111")).toEqual(MOCK_STREAMS); // original still there
  });

  it("CACHE_ENABLED=false in the environment disables the cache at startup", async () => {
    process.env.CACHE_ENABLED = "false";
    vi.resetModules();
    const mod = await import("../src/core/cache.js");
    expect(mod.isCacheEnabled()).toBe(false);
    await mod.cacheSet("i33333333", MOCK_TYPES, MOCK_STREAMS);
    expect(await mod.cacheGet("i33333333")).toBeNull();
  });

  // ── Envelope v2: type-coverage hit/miss ───────────────────────────────────
  it("hits when required types ⊆ recorded types", async () => {
    await cacheSet("i44444444", ["time", "watts", "altitude", "StrydILR"], MOCK_STREAMS);
    // a covered subset → hit
    expect(await cacheGet("i44444444", ["time", "watts"])).toEqual(MOCK_STREAMS);
    // exact set → hit
    expect(await cacheGet("i44444444", ["time", "watts", "altitude", "StrydILR"])).toEqual(MOCK_STREAMS);
    // no requirement → hit
    expect(await cacheGet("i44444444")).toEqual(MOCK_STREAMS);
  });

  it("misses when a required type was not in the recorded request set", async () => {
    // Mimics the v1 bug: summary cached without ILR/altitude, CI tool needs them.
    await cacheSet("i55555555", ["time", "fixed_watts"], MOCK_STREAMS);
    expect(await cacheGet("i55555555", ["StrydILR"])).toBeNull();
    expect(await cacheGet("i55555555", ["time", "altitude"])).toBeNull();
  });

  it("coverage is judged on the requested set, not on which streams came back", async () => {
    // StrydILR was requested but the activity had none, so it is absent from the
    // stored streams — yet a later StrydILR request is still a hit (no re-fetch).
    await cacheSet("i66666666", ["time", "StrydILR"], MOCK_STREAMS);
    expect(await cacheGet("i66666666", ["StrydILR"])).toEqual(MOCK_STREAMS);
  });

  it("treats a legacy v1 array file as a miss (replaced on next set)", async () => {
    // Pre-v2 cache files were a bare ActivityStreamRaw[]; write one directly.
    await writeFile(join(testDir, "i77777777.json"), JSON.stringify(MOCK_STREAMS));
    expect(await cacheGet("i77777777")).toBeNull();
    expect(await cacheGet("i77777777", ["time"])).toBeNull();
    // a subsequent set upgrades it to v2
    await cacheSet("i77777777", MOCK_TYPES, MOCK_STREAMS);
    expect(await cacheGet("i77777777", ["time"])).toEqual(MOCK_STREAMS);
  });
});
