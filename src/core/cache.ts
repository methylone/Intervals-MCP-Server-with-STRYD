// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Disk-based cache for activity stream data.
 *
 * Key: activity ID (e.g. "i12345678")
 * Value: ActivityStreamRaw[] serialized as JSON
 * Files: {cacheDir}/{activityId}.json
 * Immutable data: no TTL, no eviction logic
 * Invalidation: manual — the `clear_cache` tool or `rm -rf <CACHE_DIR>`
 * Enable/disable: starts from CACHE_ENABLED; flip at runtime via setCacheEnabled
 *   (the set_cache_enabled tool). When disabled, reads/writes are bypassed entirely.
 */

import { readFile, writeFile, mkdir, rm, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { config_ } from "../config.js";
import type { ActivityStreamRaw } from "./types.js";

// Process-global runtime switch, initialized from config. In HTTP mode this is
// shared across all sessions; restarting the server resets it to the env default.
let cacheEnabled = config_.cacheEnabled;

/** Whether the stream cache is currently active. */
export function isCacheEnabled(): boolean {
  return cacheEnabled;
}

/** Enable or disable the stream cache at runtime (does not touch existing files). */
export function setCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled;
}

function cachePath(activityId: string): string {
  return join(config_.cacheDir, `${activityId}.json`);
}

/**
 * Read cached streams for an activity.
 * Returns null on cache miss or any read error.
 */
export async function cacheGet(activityId: string): Promise<ActivityStreamRaw[] | null> {
  if (!cacheEnabled) return null; // disabled → always a miss, fetch fresh
  try {
    const raw = await readFile(cachePath(activityId), "utf-8");
    return JSON.parse(raw) as ActivityStreamRaw[];
  } catch {
    return null;
  }
}

/**
 * Write streams to cache. Creates the cache directory if needed.
 * Failures are silently ignored (cache is best-effort).
 */
export async function cacheSet(activityId: string, streams: ActivityStreamRaw[]): Promise<void> {
  if (!cacheEnabled) return; // disabled → don't write
  try {
    await mkdir(config_.cacheDir, { recursive: true });
    await writeFile(cachePath(activityId), JSON.stringify(streams));
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
