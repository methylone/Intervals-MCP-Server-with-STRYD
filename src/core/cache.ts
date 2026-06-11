// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Disk-based cache for activity stream data.
 *
 * Key: activity ID (e.g. "i12345678")
 * Files: {cacheDir}/{activityId}.json
 * Value: a CacheEnvelopeV2 — `{ v: 2, types, streams }`. `types` records the
 *   stream types that were REQUESTED from the API (not merely those it returned),
 *   so a later read can tell "this type was requested but the API had none"
 *   (a real hit, no re-fetch) apart from "this type was never requested" (a miss).
 *   This closes the envelope-v1 bug where a cache populated by the summary tool
 *   (which never requests ILR/altitude) silently served ILR-less data to a
 *   consumer that needs ILR. See cacheGet's requiredTypes check.
 * Legacy v1 files (a bare ActivityStreamRaw[]) are treated as a miss and replaced
 *   on the next cacheSet — no manual `rm -rf` needed, just one extra fetch.
 * Immutable data: no TTL, no eviction logic
 * Invalidation: manual — the `clear_cache` tool or `rm -rf <CACHE_DIR>`
 * Enable/disable: starts from CACHE_ENABLED; flip at runtime via setCacheEnabled
 *   (the set_cache_enabled tool). When disabled, reads/writes are bypassed entirely.
 */

import { readFile, writeFile, mkdir, rm, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { config_ } from "../config.js";
import type { ActivityStreamRaw } from "./types.js";

// Process-global runtime override for the cache switch. `null` means "fall back
// to the configured CACHE_ENABLED default", read lazily on first use so that
// importing this module needs no valid env (see config.ts). In HTTP mode this is
// shared across all sessions; restarting the server resets it to the env default.
let cacheEnabledOverride: boolean | null = null;

/** Whether the stream cache is currently active. */
export function isCacheEnabled(): boolean {
  return cacheEnabledOverride ?? config_.cacheEnabled;
}

/** Enable or disable the stream cache at runtime (does not touch existing files). */
export function setCacheEnabled(enabled: boolean): void {
  cacheEnabledOverride = enabled;
}

function cachePath(activityId: string): string {
  return join(config_.cacheDir, `${activityId}.json`);
}

/** Versioned cache file payload. `types` = the types requested when fetched. */
interface CacheEnvelopeV2 {
  v: 2;
  types: string[];
  streams: ActivityStreamRaw[];
}

function isEnvelopeV2(value: unknown): value is CacheEnvelopeV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { v?: unknown }).v === 2 &&
    Array.isArray((value as { types?: unknown }).types) &&
    Array.isArray((value as { streams?: unknown }).streams)
  );
}

/**
 * Read cached streams for an activity.
 *
 * A hit requires that every type in `requiredTypes` was among the types the
 * cached entry was fetched with (`requiredTypes ⊆ envelope.types`). This is a
 * subset check on the REQUEST, not on the returned data: an activity legitimately
 * missing a stream still counts as covered, because it was asked for. Pass `[]`
 * to accept any envelope.
 *
 * Returns null on cache miss, a legacy v1 file, an uncovered type set, or any
 * read error.
 */
export async function cacheGet(
  activityId: string,
  requiredTypes: string[] = [],
): Promise<ActivityStreamRaw[] | null> {
  if (!isCacheEnabled()) return null; // disabled → always a miss, fetch fresh
  try {
    const raw = await readFile(cachePath(activityId), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isEnvelopeV2(parsed)) return null; // legacy v1 array or junk → miss
    const have = new Set(parsed.types);
    if (!requiredTypes.every((t) => have.has(t))) return null; // partial coverage → miss
    return parsed.streams;
  } catch {
    return null;
  }
}

/**
 * Write streams to cache as a v2 envelope. `requestedTypes` is the type list the
 * fetch was made with (recorded so future reads can judge coverage — see
 * cacheGet). Creates the cache directory if needed. Failures are silently
 * ignored (cache is best-effort).
 */
export async function cacheSet(
  activityId: string,
  requestedTypes: string[],
  streams: ActivityStreamRaw[],
): Promise<void> {
  if (!isCacheEnabled()) return; // disabled → don't write
  try {
    await mkdir(config_.cacheDir, { recursive: true });
    const envelope: CacheEnvelopeV2 = { v: 2, types: requestedTypes, streams };
    await writeFile(cachePath(activityId), JSON.stringify(envelope));
  } catch (err) {
    console.error(`[cache] Failed to write cache for ${activityId}:`, err);
  }
}

/**
 * Clear cached streams. With no argument, removes every `*.json` file in the cache
 * directory; with an activityId, removes only that activity's file.
 * Returns the number of files deleted. Best-effort: any error is logged and counted
 * as 0 rather than thrown (callers must not crash on a cache failure).
 *
 * Security: activityId is interpolated into a filename, so deletion is confined to
 * the cache directory. The resolved target's parent must equal the cache directory;
 * anything that would escape it (path separators, `..`) is refused. The clear_cache
 * tool also rejects such values at its input boundary (defense in depth).
 */
export async function cacheClear(activityId?: string): Promise<number> {
  try {
    const baseDir = resolve(config_.cacheDir);

    if (activityId === undefined) {
      let entries: string[];
      try {
        entries = await readdir(baseDir);
      } catch {
        return 0; // cache dir doesn't exist yet — nothing cached
      }
      let count = 0;
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        await rm(join(baseDir, entry), { force: true });
        count++;
      }
      return count;
    }

    const target = resolve(baseDir, `${activityId}.json`);
    if (dirname(target) !== baseDir) {
      console.error(`[cache] Refusing to clear outside cache dir: ${activityId}`);
      return 0;
    }
    try {
      await stat(target); // distinguish "deleted 1" from "nothing was cached"
    } catch {
      return 0;
    }
    await rm(target, { force: true });
    return 1;
  } catch (err) {
    console.error(`[cache] Failed to clear cache:`, err);
    return 0;
  }
}
