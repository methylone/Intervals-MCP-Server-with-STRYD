// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Transport-free tool registry (Stage 2 Phase 0).
 *
 * `ToolDef` is the decoupled tool contract: a handler returns *raw data*
 * (hard failure = throw), and the transport adapters (src/adapters/*) own
 * schema validation, default application, and output enveloping.
 *
 * This module must stay transport-free — it imports neither express nor
 * src/index.ts. Both index.ts and cli.ts import TOOLS from here.
 */
import type { ZodRawShape } from "zod";
import { getActivitiesTool } from "./core/tools/get-activities.js";
import { getActivityDetailTool } from "./core/tools/get-activity-detail.js";
import { getWellnessTool } from "./core/tools/get-wellness.js";
import { getAthleteSummaryTool } from "./core/tools/get-athlete-summary.js";
import { getStreamsSummaryTool } from "./core/tools/get-streams-summary.js";
import { searchSimilarActivitiesTool } from "./core/tools/search-similar-activities.js";
import { getEventsTool } from "./core/tools/get-events.js";
import { createEventsTool } from "./core/tools/create-events.js";
import { updateEventTool } from "./core/tools/update-event.js";
import { deleteEventTool } from "./core/tools/delete-event.js";
import { deleteEventsTool } from "./core/tools/delete-events.js";
import { getHrvTrendsTool } from "./core/tools/get-hrv-trends.js";
import { clearCacheTool } from "./core/tools/clear-cache.js";
import { setCacheEnabledTool } from "./core/tools/set-cache-enabled.js";
import { getCurrentPmcTool } from "./extensions/stryd/tools/get-current-pmc.js";
import { getWeeklySummaryTool } from "./extensions/stryd/tools/get-weekly-summary.js";
import { getPhaseSummaryTool } from "./extensions/stryd/tools/get-phase-summary.js";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** Current MCP `inputSchema` shape, reused verbatim by both adapters. */
  schema: ZodRawShape;
  /** Returns raw data on success; throws on hard failure. */
  handler: (args: any, context?: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  signal?: AbortSignal;
}

export const TOOLS: ToolDef[] = [
  // Core
  getActivitiesTool,
  getActivityDetailTool,
  getStreamsSummaryTool,
  searchSimilarActivitiesTool,
  getWellnessTool,
  getAthleteSummaryTool,
  getEventsTool,
  createEventsTool,
  updateEventTool,
  deleteEventTool,
  deleteEventsTool,
  getHrvTrendsTool,
  clearCacheTool,
  setCacheEnabledTool,
  // Stryd extensions
  getCurrentPmcTool,
  getWeeklySummaryTool,
  getPhaseSummaryTool,
];
