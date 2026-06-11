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
 * Intervals.icu custom-field codes are CamelCase: letters/digits only, leading
 * letter, no underscore (the web UI rejects `_`). The LBSS/ILR field-name env
 * vars and the per-call `lbss_field` overrides are validated against this so a
 * malformed name fails fast instead of silently reading `undefined`.
 */
export const FIELD_NAME_REGEX = /^[A-Za-z][A-Za-z0-9]*$/;
const FIELD_NAME_ERROR =
  "must be a CamelCase custom-field code (letters/digits, leading letter, no underscore), e.g. StrydLBSSv2";

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
  // When "true", the four account-writing tools (create_events / update_event /
  // delete_event / delete_events) are not registered. Local-only side effects
  // (clear_cache / set_cache_enabled) are unaffected. See isReadOnly() — the
  // tool filter reads this WITHOUT triggering full credential validation, so
  // `cli list` works read-only without a configured .env.
  READ_ONLY: z
    .enum(["true", "false"])
    .default("false"),
  ATHLETE_TIMEZONE: z
    .string()
    .default("UTC")
    .refine(
      isValidIanaTimeZone,
      "ATHLETE_TIMEZONE must be a valid IANA timezone (e.g. Asia/Tokyo, UTC)",
    ),
  // Custom-field names the Stryd aggregation tools read off each activity.
  // Configurable so a recalibrated / renamed field (e.g. StrydLBSSv2) needs no
  // code change. Per-call `lbss_field` overrides these; see the tool schemas.
  // v0.6.0: the LBSS default moved StrydLBSSmod → StrydLBSSv2. Restore the old
  // behavior with LBSS_FIELD=StrydLBSSmod.
  LBSS_FIELD: z
    .string()
    .regex(FIELD_NAME_REGEX, `LBSS_FIELD ${FIELD_NAME_ERROR}`)
    .default("StrydLBSSv2"),
  ILR_FIELD: z
    .string()
    .regex(FIELD_NAME_REGEX, `ILR_FIELD ${FIELD_NAME_ERROR}`)
    .default("StrydILR"),
  // Eccentric LBSS custom-field name (v0.7.1, #16-lite). The include_ecc flag on
  // the aggregation tools reports this field alongside lbss. An empty string
  // DISABLES the feature (include_ecc then errors fast); any non-empty value is
  // validated as a CamelCase code like the other field vars.
  ECC_FIELD: z
    .union([z.literal(""), z.string().regex(FIELD_NAME_REGEX, `ECC_FIELD ${FIELD_NAME_ERROR}`)])
    .default("EccLBSS"),
  // Comma-separated list of Intervals.icu custom stream codes to fetch and
  // surface as per-split averages in get_activity_streams_summary. Default ""
  // (disabled). Each code is validated as a CamelCase field name. Example:
  // EXTRA_STREAM_FIELDS=StrydLSS,StrydTemp,StrydHumidity
  EXTRA_STREAM_FIELDS: z
    .string()
    .default(""),
});

export interface AppConfig {
  athleteId: string;
  apiKey: string;
  transport: "stdio" | "http";
  port: number;
  cacheDir: string;
  cacheEnabled: boolean;
  readOnly: boolean;
  timezone: string;
  /** Primary LBSS custom-field name (env LBSS_FIELD, default StrydLBSSv2). */
  lbssField: string;
  /** ILR custom-field name (env ILR_FIELD, default StrydILR). */
  ilrField: string;
  /** Eccentric LBSS custom-field name (env ECC_FIELD, default EccLBSS; "" disables include_ecc). */
  eccField: string;
  /** Extra Intervals custom stream codes for per-split avg in streams summary (env EXTRA_STREAM_FIELDS, default []). */
  extraStreamFields: string[];
}

/**
 * Whether account-writing tools should be withheld. Reads process.env directly
 * (no loadConfig) so the credential-free paths — `cli list` / `cli --help` /
 * tool enumeration — can apply READ_ONLY without a valid .env. The validated
 * `config_.readOnly` mirrors this for the server path (creds already required).
 */
export function isReadOnly(): boolean {
  return process.env.READ_ONLY === "true";
}

let cached: AppConfig | null = null;

/**
 * Validate process.env against envSchema and build the config (memoized).
 * Throws an Error with a human-readable summary if validation fails — it does
 * NOT exit the process (the error model leaves termination to the caller).
 *
 * Validation is deliberately lazy: importing this module — and therefore the
 * tool registry that the CLI loads — must not require valid credentials, so
 * `cli --help` / `cli list` / tool descriptions work with an absent or
 * unconfigured .env. Credentials are only needed when a tool actually runs or
 * when the MCP server boots (see index.ts, which calls loadConfig() up front).
 */
export function loadConfig(): AppConfig {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Environment variable validation failed:\n${messages}`);
  }

  // Parse EXTRA_STREAM_FIELDS: split by comma, trim, drop empty, validate each,
  // then dedupe (including dedup against ILR_FIELD to avoid double-fetching).
  const rawExtras = parsed.data.EXTRA_STREAM_FIELDS;
  const extraStreamFields: string[] = [];
  if (rawExtras.trim() !== "") {
    const parts = rawExtras.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const invalids = parts.filter((s) => !FIELD_NAME_REGEX.test(s));
    if (invalids.length > 0) {
      throw new Error(
        `Environment variable validation failed:\n  EXTRA_STREAM_FIELDS: "${invalids[0]}" ${FIELD_NAME_ERROR}`,
      );
    }
    const seen = new Set<string>([parsed.data.ILR_FIELD]);
    for (const code of parts) {
      if (!seen.has(code)) {
        seen.add(code);
        extraStreamFields.push(code);
      }
    }
  }

  cached = {
    athleteId: parsed.data.INTERVALS_ATHLETE_ID,
    apiKey: parsed.data.INTERVALS_API_KEY,
    transport: parsed.data.MCP_TRANSPORT,
    port: parseInt(parsed.data.MCP_PORT, 10),
    cacheDir: parsed.data.CACHE_DIR ?? defaultCacheDir(),
    cacheEnabled: parsed.data.CACHE_ENABLED === "true",
    readOnly: parsed.data.READ_ONLY === "true",
    timezone: parsed.data.ATHLETE_TIMEZONE,
    lbssField: parsed.data.LBSS_FIELD,
    ilrField: parsed.data.ILR_FIELD,
    eccField: parsed.data.ECC_FIELD,
    extraStreamFields,
  };
  return cached;
}

/**
 * Lazily-validated config accessor. Reading any property triggers loadConfig()
 * on first access; merely importing this module does not. Keeps every existing
 * `config_.apiKey` / `config_.timezone` call site unchanged.
 */
export const config_: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop) {
    return loadConfig()[prop as keyof AppConfig];
  },
});
