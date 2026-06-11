// SPDX-License-Identifier: AGPL-3.0-or-later
import { config_ } from "../config.js";
import { cacheGet, cacheSet } from "./cache.js";
import { canonicalStreamTypes } from "./stream-types.js";
import type { ActivityStreamRaw, CalendarEvent, CreateEventInput, UpdateEventInput } from "./types.js";

const BASE_URL = "https://intervals.icu/api/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Fallback wait before a single 429 retry when no Retry-After header is given. */
const RATE_LIMIT_RETRY_SEC = 15;

/** Abortable sleep: rejects if the signal fires while waiting. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted while waiting to retry"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Error("Aborted while waiting to retry"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Error for a non-2xx Intervals.icu response.
 *
 * `message` carries the upstream response body so the consumer-facing error
 * (the MCP isError text the LLM sees / the CLI's stderr the human reads) keeps
 * the diagnostic detail. `logSafeMessage` is a body-free summary (status +
 * statusText only) for *persistent* log sinks: the upstream body can contain
 * account data, and a server log line must not retain it. Adapters that write
 * to a persistent log (see src/adapters/mcp.ts) log `logSafeMessage` instead of
 * `message` — the convention is purely structural (a string property), so no
 * adapter needs to import this class.
 */
export class IntervalsApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  /** Body-free summary, safe to write to persistent logs. */
  readonly logSafeMessage: string;
  /** Parsed `Retry-After` header in seconds, when present (429/503). */
  readonly retryAfterSeconds?: number;

  constructor(status: number, statusText: string, body: string, retryAfterSeconds?: number) {
    const summary = `Intervals.icu API error: ${status} ${statusText}`;
    super(body ? `${summary} — ${body}` : summary);
    this.name = "IntervalsApiError";
    this.status = status;
    this.statusText = statusText;
    this.logSafeMessage = summary;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function buildAuthHeader(): string {
  const credentials = `API_KEY:${config_.apiKey}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function request<T>(path: string, options?: {
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(),
    Accept: "application/json",
  };
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => {
    controller.abort(options?.signal?.reason ?? "Caller aborted request");
  };

  if (options?.signal?.aborted) {
    abortFromParent();
  } else {
    options?.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(`Intervals.icu API request timed out after ${timeoutMs}ms`);
    }, timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options?.method ?? "GET",
      headers,
      signal: controller.signal,
      ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (err) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw new Error(`Intervals.icu API request aborted: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    throw err;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    options?.signal?.removeEventListener("abort", abortFromParent);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfter = retryAfterRaw && /^\d+$/.test(retryAfterRaw.trim())
      ? parseInt(retryAfterRaw.trim(), 10)
      : undefined;
    throw new IntervalsApiError(response.status, response.statusText, body, retryAfter);
  }

  // DELETE returns no body
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/** Backwards-compatible GET helper */
async function get<T>(path: string, params?: Record<string, string>, options?: RequestOptions): Promise<T> {
  return request<T>(path, { params, ...options });
}

export const intervalsClient = {
  getActivities(oldest: string, newest: string, options?: RequestOptions): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/activities`, {
      oldest,
      newest,
    }, options);
  },

  getActivityDetail(activityId: string, options?: RequestOptions): Promise<unknown> {
    return get<unknown>(`/activity/${activityId}`, undefined, options);
  },

  getWellness(oldest: string, newest: string, options?: RequestOptions): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/wellness`, {
      oldest,
      newest,
    }, options);
  },

  getAthleteSummary(start: string, end: string, options?: RequestOptions): Promise<unknown> {
    return get<unknown>(`/athlete/${config_.athleteId}/athlete-summary`, {
      start,
      end,
    }, options);
  },

  getEvents(oldest: string, newest: string, options?: RequestOptions): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/events`, {
      oldest,
      newest,
    }, options);
  },

  createEvent(event: CreateEventInput, options?: RequestOptions): Promise<CalendarEvent> {
    return request<CalendarEvent>(`/athlete/${config_.athleteId}/events`, {
      method: "POST",
      body: event,
      ...options,
    });
  },

  updateEvent(eventId: number, updates: UpdateEventInput, options?: RequestOptions): Promise<CalendarEvent> {
    return request<CalendarEvent>(`/athlete/${config_.athleteId}/events/${eventId}`, {
      method: "PUT",
      body: updates,
      ...options,
    });
  },

  async deleteEvent(eventId: number, options?: RequestOptions): Promise<void> {
    await request<void>(`/athlete/${config_.athleteId}/events/${eventId}`, {
      method: "DELETE",
      ...options,
    });
  },

  /** GET /athlete/{id}/gear — all gear (shoes/bikes), retired included. */
  getGear(options?: RequestOptions): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/gear`, undefined, options);
  },

  /**
   * POST /athlete/{id}/gear — create a gear item (shoe/bike).
   * PR2 probe (v0.9.0): 200 + full gear object (id, type, name, purchased,
   * notes, distance/time odometer, retired, …). The returned id is usable
   * immediately with assignActivityGear.
   */
  createGear(
    gear: { name: string; type?: string; purchased?: string; notes?: string },
    options?: RequestOptions,
  ): Promise<unknown> {
    return request<unknown>(`/athlete/${config_.athleteId}/gear`, {
      method: "POST",
      body: gear,
      ...options,
    });
  },

  /**
   * PUT /athlete/{id}/gear/{gearId} — update a gear item.
   * PR2 probe confirmed a partial update (sending {retired} changed only the
   * `retired` field; all 14 others preserved — no full-replace needed). The API
   * accepts a `YYYY-MM-DDT00:00:00` datetime and normalizes it to a date string
   * in the response.
   */
  updateGear(
    gearId: string,
    updates: { retired?: string; name?: string; notes?: string },
    options?: RequestOptions,
  ): Promise<unknown> {
    return request<unknown>(`/athlete/${config_.athleteId}/gear/${gearId}`, {
      method: "PUT",
      body: updates,
      ...options,
    });
  },

  /**
   * GET /athlete/{id}/custom-item — all custom fields/charts.
   * PR3 probe (v0.10.0): the LIST already returns each item's full `content`
   * object (including `content.code` (CamelCase field code) and `content.script`
   * (the full field script)), so no per-item GET is needed to read a script.
   */
  getCustomItems(options?: RequestOptions): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/custom-item`, undefined, options);
  },

  /**
   * PUT /athlete/{id}/custom-item/{id} — update a custom field.
   * PR3 confirmed a full-item round-trip is safe: PUT the whole item back with
   * only content.script changed → response/read-back differ only in content.script
   * (+ the server's `updated` timestamp); all 25 other content fields are preserved.
   */
  updateCustomItem(itemId: string | number, item: unknown, options?: RequestOptions): Promise<unknown> {
    return request<unknown>(`/athlete/${config_.athleteId}/custom-item/${itemId}`, {
      method: "PUT",
      body: item,
      ...options,
    });
  },

  /**
   * PUT /activity/{id} body {"gear":{"id":gearId}} — assign gear to an activity.
   * PR1 probe (v0.8.0) confirmed this is a partial update and idempotent: a
   * same-value reassign changes no other field and does not double-count the
   * gear odometer (distance/time). The `gear_id` key is rejected (422); the
   * nested `{gear:{id}}` shape is required.
   */
  assignActivityGear(activityId: string, gearId: string, options?: RequestOptions): Promise<unknown> {
    return request<unknown>(`/activity/${activityId}`, {
      method: "PUT",
      body: { gear: { id: gearId } },
      ...options,
    });
  },

  /**
   * GET /api/v1/activity/{id}/streams.json?types=...
   *
   * `types` is the caller's REQUIRED set — it decides whether a cached entry is a
   * hit (requiredTypes ⊆ cached.types). The actual fetch always requests the
   * canonical superset (summary types + watts/altitude/ILR), so one cache file
   * serves every consumer and the envelope records the full requested set. A
   * single 429 is retried once (after Retry-After, or 15s) before giving up.
   */
  async getActivityStreams(activityId: string, types?: string[], options?: RequestOptions): Promise<ActivityStreamRaw[]> {
    const requiredTypes = types ?? [];

    // Try cache first (subset-coverage check against the recorded request set)
    const cached = await cacheGet(activityId, requiredTypes);
    if (cached !== null) {
      return cached;
    }

    // Cache miss: always fetch the canonical superset so the entry is reusable.
    const fetchTypes = canonicalStreamTypes();
    const params: Record<string, string> = { types: fetchTypes.join(",") };
    const path = `/activity/${activityId}/streams.json`;

    let streams: ActivityStreamRaw[];
    try {
      streams = await get<ActivityStreamRaw[]>(path, params, options);
    } catch (err) {
      if (err instanceof IntervalsApiError && err.status === 429) {
        const waitSec = err.retryAfterSeconds ?? RATE_LIMIT_RETRY_SEC;
        await delay(waitSec * 1000, options?.signal);
        streams = await get<ActivityStreamRaw[]>(path, params, options);
      } else {
        throw err;
      }
    }

    // Write to cache (best-effort, don't block on it)
    cacheSet(activityId, fetchTypes, streams).catch(() => {});

    return streams;
  },
};
