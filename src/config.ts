// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// .env の読み込みは Node.js --env-file フラグで行う（dotenv 不要）
// Claude Desktop 経由の場合は env が直接注入される

function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Default stream-cache directory, resolved as an absolute path from this module's
 * own location rather than process.cwd(). The launch CWD differs across clients
 * (Claude Desktop / Codex / Linux server), so a cwd-relative default would point at
 * a different cache per client. This file lives at <package root>/build/config.js in
 * production (or <package root>/src/config.ts under tsx/vitest); either way the
 * parent of its directory is the package root.
 */
function defaultCacheDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "..", "cache", "streams");
}

const envSchema = z.object({
  INTERVALS_ATHLETE_ID: z
    .string()
    .min(1, "INTERVALS_ATHLETE_ID is required")
    .regex(/^(i\d+|0)$/, 'INTERVALS_ATHLETE_ID must be "0" or athlete ID like "i12345678"'),
  INTERVALS_API_KEY: z
    .string()
    .min(1, "INTERVALS_API_KEY is required"),
  MCP_TRANSPORT: z
    .enum(["stdio", "http"])
    .default("stdio"),
  MCP_PORT: z
    .string()
    .regex(/^\d+$/, "MCP_PORT must be a numeric string")
    .default("8080"),
  // Explicit value is honored as-is (absolute or relative). If unset, we resolve a
  // cwd-independent default below (see defaultCacheDir).
  CACHE_DIR: z
    .string()
    .optional(),
  // Initial on/off state of the stream cache. Can be flipped at runtime via the
  // set_cache_enabled tool; that runtime change resets to this default on restart.
  CACHE_ENABLED: z
    .enum(["true", "false"])
    .default("true"),
  ATHLETE_TIMEZONE: z
    .string()
    .default("UTC")
    .refine(
      isValidIanaTimeZone,
      "ATHLETE_TIMEZONE must be a valid IANA timezone (e.g. Asia/Tokyo, UTC)",
    ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = parsed.error.issues
    .map((e) => `  ${e.path.join(".")}: ${e.message}`)
    .join("\n");
  console.error(`[config] Environment variable validation failed:\n${messages}`);
  process.exit(1);
}

export const config_ = {
  athleteId: parsed.data.INTERVALS_ATHLETE_ID,
  apiKey: parsed.data.INTERVALS_API_KEY,
  transport: parsed.data.MCP_TRANSPORT,
  port: parseInt(parsed.data.MCP_PORT, 10),
  cacheDir: parsed.data.CACHE_DIR ?? defaultCacheDir(),
  cacheEnabled: parsed.data.CACHE_ENABLED === "true",
  timezone: parsed.data.ATHLETE_TIMEZONE,
} as const;
