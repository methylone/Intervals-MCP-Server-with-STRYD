// SPDX-License-Identifier: AGPL-3.0-or-later
import { config_ } from "../config.js";
import { cacheGet, cacheSet } from "./cache.js";
import type { ActivityStreamRaw, CalendarEvent, CreateEventInput, UpdateEventInput } from "./types.js";

const BASE_URL = "https://intervals.icu/api/v1";

function buildAuthHeader(): string {
  const credentials = `API_KEY:${config_.apiKey}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function request<T>(path: string, options?: {
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
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

  const response = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    headers,
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

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
async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  return request<T>(path, { params });
}

export const intervalsClient = {
  getActivities(oldest: string, newest: string): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/activities`, {
      oldest,
      newest,
    });
  },

  getActivityDetail(activityId: string): Promise<unknown> {
    return get<unknown>(`/activity/${activityId}`);
  },

  getWellness(oldest: string, newest: string): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/wellness`, {
      oldest,
      newest,
    });
  },

  getAthleteSummary(start: string, end: string): Promise<unknown> {
    return get<unknown>(`/athlete/${config_.athleteId}/athlete-summary`, {
      start,
      end,
    });
  },

  getEvents(oldest: string, newest: string): Promise<unknown[]> {
    return get<unknown[]>(`/athlete/${config_.athleteId}/events`, {
      oldest,
      newest,
    });
  },

  createEvent(event: CreateEventInput): Promise<CalendarEvent> {
    return request<CalendarEvent>(`/athlete/${config_.athleteId}/events`, {
      method: "POST",
      body: event,
    });
  },

  updateEvent(eventId: number, updates: UpdateEventInput): Promise<CalendarEvent> {
    return request<CalendarEvent>(`/athlete/${config_.athleteId}/events/${eventId}`, {
      method: "PUT",
      body: updates,
    });
  },

  async deleteEvent(eventId: number): Promise<void> {
    await request<void>(`/athlete/${config_.athleteId}/events/${eventId}`, {
      method: "DELETE",
    });
  },

  /**
   * GET /api/v1/activity/{id}/streams.json?types=...
   * types 省略 → stored streams のみ返却
   * types 指定 → computed streams (fixed_heartrate, fixed_watts 等) も取得可能
   */
  async getActivityStreams(activityId: string, types?: string[]): Promise<ActivityStreamRaw[]> {
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
    const streams = await get<ActivityStreamRaw[]>(`/activity/${activityId}/streams.json`, params);

    // Write to cache (best-effort, don't await blocking)
    cacheSet(activityId, streams).catch(() => {});

    return streams;
  },
};
