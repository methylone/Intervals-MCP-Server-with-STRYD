// SPDX-License-Identifier: AGPL-3.0-or-later
import { config_ } from "../config.js";
import { cacheGet, cacheSet } from "./cache.js";
import type { ActivityStreamRaw, CalendarEvent, CreateEventInput, UpdateEventInput } from "./types.js";

const BASE_URL = "https://intervals.icu/api/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

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
    throw new Error(
      `Intervals.icu API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`
    );
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

  /**
   * GET /api/v1/activity/{id}/streams.json?types=...
   * types 省略 → stored streams のみ返却
   * types 指定 → computed streams (fixed_heartrate, fixed_watts 等) も取得可能
   */
  async getActivityStreams(activityId: string, types?: string[], options?: RequestOptions): Promise<ActivityStreamRaw[]> {
    // Try cache first
    const cached = await cacheGet(activityId);
    if (cached !== null) {
      return cached;
    }

    // Cache miss: fetch from API
    const params: Record<string, string> = {};
    if (types && types.length > 0) {
      params.types = types.join(",");
    }
    const streams = await get<ActivityStreamRaw[]>(`/activity/${activityId}/streams.json`, params, options);

    // Write to cache (best-effort, don't await blocking)
    cacheSet(activityId, streams).catch(() => {});

    return streams;
  },
};
