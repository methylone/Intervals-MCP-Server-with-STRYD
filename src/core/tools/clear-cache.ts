// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cacheClear } from "../cache.js";

export function registerClearCache(server: McpServer): void {
  server.registerTool(
    "clear_cache",
    {
      title: "Clear Stream Cache",
      description:
        "Clear the on-disk stream cache (all cached activities, or a single one). " +
        "Use after re-uploading a FIT file or changing elevation correction on " +
        "Intervals.icu, since the server is not notified of upstream changes. " +
        "FTP/CP changes do not affect streams, so no flush is needed for those. " +
        "Omit activity_id to clear the entire cache.",
      inputSchema: {
        activity_id: z
          .string()
          .min(1)
          .refine(
            (s) => !/\s/.test(s) && !/[^\x20-\x7E]/.test(s),
            "This looks like an activity name, not an ID. " +
            "Call get_activities first to get the activity_id field (e.g. 'i12345678')."
          )
          // activity_id is interpolated into a cache filename — reject anything that
          // could escape the cache directory.
          .refine(
            (s) => !/[/\\]/.test(s) && !s.includes(".."),
            "activity_id must not contain path separators ('/' or '\\\\') or '..'."
          )
          .optional()
          .describe(
            "Optional Intervals.icu activity ID (e.g. 'i12345678') to clear a single " +
            "cached activity. Omit to clear the entire stream cache."
          ),
      },
    },
    async ({ activity_id }) => {
      const filesDeleted = await cacheClear(activity_id);
      const result =
        activity_id === undefined
          ? { cleared: "all", files_deleted: filesDeleted }
          : { cleared: activity_id, files_deleted: filesDeleted };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
