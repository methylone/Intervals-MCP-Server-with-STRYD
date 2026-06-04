// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { intervalsClient } from "../intervals-client.js";
import type { Activity } from "../types.js";

export function formatPace(movingTimeSec: number, distanceMeters: number): string | null {
  if (!distanceMeters || distanceMeters <= 0) return null;
  const secPerKm = movingTimeSec / (distanceMeters / 1000);
  let minutes = Math.floor(secPerKm / 60);
  let seconds = Math.round(secPerKm % 60);
  if (seconds === 60) { minutes += 1; seconds = 0; }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function avgOrNull(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export function registerSearchSimilarActivities(server: McpServer): void {
  server.registerTool(
    "search_similar_activities",
    {
      title: "Search Similar Activities",
      description:
        "Search past activities within a date range using optional filters " +
        "(type, name keyword, distance, duration, temperature). Returns matching activities " +
        "with derived metrics (pace, efficiency factor, weather) and aggregate summary. " +
        "Useful for estimating LBSS/RSS of planned sessions based on similar past efforts, " +
        "and for comparing performance across different temperature conditions. " +
        "Temperature filters use feels-like temp (Open-Meteo). Activities without weather data " +
        "(has_weather=false) are excluded when temp filters are set.",
      inputSchema: {
        oldest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Search range start date (inclusive), YYYY-MM-DD"),
        newest: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
          .describe("Search range end date (inclusive), YYYY-MM-DD"),
        type: z
          .string()
          .optional()
          .describe('Activity type filter, e.g. "Run", "VirtualRun"'),
        name_contains: z
          .string()
          .optional()
          .describe("Case-insensitive substring match on activity name"),
        distance_min_km: z
          .number()
          .optional()
          .describe("Minimum distance in km"),
        distance_max_km: z
          .number()
          .optional()
          .describe("Maximum distance in km"),
        duration_min_minutes: z
          .number()
          .optional()
          .describe("Minimum duration in minutes (based on moving_time)"),
        duration_max_minutes: z
          .number()
          .optional()
          .describe("Maximum duration in minutes (based on moving_time)"),
        temp_min_celsius: z
          .number()
          .optional()
          .describe("Minimum feels-like temperature in °C (Open-Meteo). Activities without weather data are excluded when this filter is set."),
        temp_max_celsius: z
          .number()
          .optional()
          .describe("Maximum feels-like temperature in °C (Open-Meteo). Activities without weather data are excluded when this filter is set."),
        sort_by: z
          .enum(["date", "distance", "rss", "lbss"])
          .optional()
          .describe('Sort key: "date" (newest first, default), "distance", "rss", "lbss"'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of results to return (default: 20)"),
      },
    },
    async ({
      oldest,
      newest,
      type,
      name_contains,
      distance_min_km,
      distance_max_km,
      duration_min_minutes,
      duration_max_minutes,
      temp_min_celsius,
      temp_max_celsius,
      sort_by = "date",
      limit = 20,
    }) => {
      const raw = await intervalsClient.getActivities(oldest, newest);
      const activities = raw as Activity[];

      // Build filter descriptions
      const filtersApplied: string[] = [];
      if (type) filtersApplied.push(`type=${type}`);
      if (name_contains) filtersApplied.push(`name contains "${name_contains}"`);
      if (distance_min_km != null && distance_max_km != null) {
        filtersApplied.push(`distance: ${distance_min_km}-${distance_max_km}km`);
      } else if (distance_min_km != null) {
        filtersApplied.push(`distance >= ${distance_min_km}km`);
      } else if (distance_max_km != null) {
        filtersApplied.push(`distance <= ${distance_max_km}km`);
      }
      if (duration_min_minutes != null && duration_max_minutes != null) {
        filtersApplied.push(`duration: ${duration_min_minutes}-${duration_max_minutes}min`);
      } else if (duration_min_minutes != null) {
        filtersApplied.push(`duration >= ${duration_min_minutes}min`);
      } else if (duration_max_minutes != null) {
        filtersApplied.push(`duration <= ${duration_max_minutes}min`);
      }
      if (temp_min_celsius != null && temp_max_celsius != null) {
        filtersApplied.push(`temp: ${temp_min_celsius}-${temp_max_celsius}°C`);
      } else if (temp_min_celsius != null) {
        filtersApplied.push(`temp >= ${temp_min_celsius}°C`);
      } else if (temp_max_celsius != null) {
        filtersApplied.push(`temp <= ${temp_max_celsius}°C`);
      }

      // Apply filters
      const matched = activities.filter((a) => {
        if (type && a.type !== type) return false;
        if (name_contains && !a.name.toLowerCase().includes(name_contains.toLowerCase())) return false;

        const distKm = a.distance / 1000;
        if (distance_min_km != null && distKm < distance_min_km) return false;
        if (distance_max_km != null && distKm > distance_max_km) return false;

        const durationMin = a.moving_time / 60;
        if (duration_min_minutes != null && durationMin < duration_min_minutes) return false;
        if (duration_max_minutes != null && durationMin > duration_max_minutes) return false;

        // Temperature filter (uses feels-like from Open-Meteo)
        if (temp_min_celsius != null || temp_max_celsius != null) {
          if (!a.has_weather) return false;
          const temp = typeof a.average_feels_like === "number" ? a.average_feels_like : null;
          if (temp === null) return false;
          if (temp_min_celsius != null && temp < temp_min_celsius) return false;
          if (temp_max_celsius != null && temp > temp_max_celsius) return false;
        }

        return true;
      });

      // Sort
      matched.sort((a, b) => {
        switch (sort_by) {
          case "distance":
            return b.distance - a.distance;
          case "rss":
            return ((b.icu_training_load ?? 0) - (a.icu_training_load ?? 0));
          case "lbss":
            return ((b.StrydLBSSmod ?? 0) - (a.StrydLBSSmod ?? 0));
          case "date":
          default:
            return b.start_date_local.localeCompare(a.start_date_local);
        }
      });

      // Map to output shape (before applying limit, for summary computation)
      const mappedAll = matched.map((a) => {
        const distKm = Math.round((a.distance / 1000) * 100) / 100;
        const durationMin = Math.round((a.moving_time / 60) * 10) / 10;
        const avgPower = typeof a.icu_average_watts === "number" ? a.icu_average_watts : null;
        const avgHr = typeof a.average_heartrate === "number" ? a.average_heartrate : null;
        const ef = typeof a.icu_efficiency_factor === "number" ? a.icu_efficiency_factor : null;

        const elevGain = typeof a.total_elevation_gain === "number"
          ? Math.round(a.total_elevation_gain)
          : null;

        return {
          id: a.id,
          date: a.start_date_local.slice(0, 10),
          name: a.name,
          type: a.type,
          distance_km: distKm,
          duration_min: durationMin,
          elevation_gain_m: elevGain,
          rss: a.icu_training_load ?? null,
          lbss: a.StrydLBSSmod ?? null,
          ilr: a.StrydILR ?? null,
          avg_hr: avgHr,
          avg_power: avgPower,
          pace_per_km: formatPace(a.moving_time, a.distance),
          decoupling: a.decoupling ?? null,
          efficiency_factor: ef,
          avg_feels_like: typeof a.average_feels_like === "number"
            ? Math.round(a.average_feels_like * 10) / 10
            : null,
          avg_weather_temp: typeof a.average_weather_temp === "number"
            ? Math.round(a.average_weather_temp * 10) / 10
            : null,
          avg_wind_speed: typeof a.average_wind_speed === "number"
            ? Math.round(a.average_wind_speed * 100) / 100
            : null,
        };
      });

      // Summary over ALL matched (before limit)
      const summary = {
        avg_rss: avgOrNull(mappedAll.map((a) => a.rss)),
        avg_lbss: avgOrNull(mappedAll.map((a) => a.lbss)),
        avg_duration_min:
          mappedAll.length > 0
            ? Math.round(
                (mappedAll.reduce((s, a) => s + a.duration_min, 0) / mappedAll.length) * 10
              ) / 10
            : 0,
        avg_distance_km:
          mappedAll.length > 0
            ? Math.round(
                (mappedAll.reduce((s, a) => s + a.distance_km, 0) / mappedAll.length) * 100
              ) / 100
            : 0,
        avg_ilr: avgOrNull(mappedAll.map((a) => a.ilr)),
        avg_feels_like: avgOrNull(mappedAll.map((a) => a.avg_feels_like)),
        avg_weather_temp: avgOrNull(mappedAll.map((a) => a.avg_weather_temp)),
        avg_wind_speed: avgOrNull(mappedAll.map((a) => a.avg_wind_speed)),
      };

      const result = {
        query: {
          oldest,
          newest,
          filters_applied: filtersApplied,
        },
        total_matched: matched.length,
        activities: mappedAll.slice(0, limit),
        summary,
      };

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
