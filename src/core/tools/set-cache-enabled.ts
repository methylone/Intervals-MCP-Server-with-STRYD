// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { ToolDef } from "../../tool-registry.js";
import { isCacheEnabled, setCacheEnabled } from "../cache.js";

export const setCacheEnabledTool: ToolDef = {
  name: "set_cache_enabled",
  title: "Enable/Disable Stream Cache",
  description:
    "Turn the on-disk stream cache on or off at runtime, or query its current state. " +
    "When disabled, get_activity_streams_summary and other stream reads always fetch " +
    "fresh data from Intervals.icu and write nothing to disk, and existing cached files " +
    "are ignored (not deleted — use clear_cache to remove them). " +
    "Omit 'enabled' to read the current state without changing it. " +
    "The change applies to the whole server process and resets to the CACHE_ENABLED " +
    "environment default on restart.",
  schema: {
    enabled: z
      .boolean()
      .optional()
      .describe(
        "true to enable the cache, false to disable it. Omit to query the current state."
      ),
  },
  handler: async ({ enabled }: { enabled?: boolean }) => {
    if (enabled !== undefined) {
      setCacheEnabled(enabled);
    }
    return { cache_enabled: isCacheEnabled() };
  },
};
