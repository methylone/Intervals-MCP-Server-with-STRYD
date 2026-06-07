// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared PII-guard helpers.
 *
 * The allowlist vocabulary (author names, email domains, placeholder usernames)
 * is loaded from `pii-guard.config.json` at the repo root rather than hard-coded
 * here, so a fork can adopt these guards by editing one JSON file instead of
 * patching test code — the README invites forking, and a fork shouldn't inherit
 * a red test that protects *someone else's* identity.
 *
 * `loadForbiddenStrings` reads an OPTIONAL, gitignored deny-list of literal
 * strings that must never appear in published artifacts (the maintainer's real
 * name, real email, home path, etc.). That file is intentionally NOT committed
 * and is excluded from the public snapshot — the real PII literals must not live
 * in public test code, which would itself become a leak source.
 *
 * Contract for `.pii-forbidden`: one literal per line; blank lines and `#`
 * comments ignored. Returns null when absent (public clones / fresh checkouts
 * skip the deep check; the structural checks still run unconditionally).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const FORBIDDEN_FILENAME = ".pii-forbidden";
export const CONFIG_FILENAME = "pii-guard.config.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PiiGuardConfig {
  allowedAuthorNames: string[];
  allowedEmails: string[];
  allowedEmailDomains: string[];
  placeholderUsernames: string[];
}

function loadConfig(): PiiGuardConfig {
  const raw = JSON.parse(readFileSync(join(repoRoot, CONFIG_FILENAME), "utf-8")) as Partial<PiiGuardConfig>;
  return {
    allowedAuthorNames: raw.allowedAuthorNames ?? [],
    allowedEmails: raw.allowedEmails ?? [],
    allowedEmailDomains: raw.allowedEmailDomains ?? [],
    placeholderUsernames: raw.placeholderUsernames ?? [],
  };
}

const CONFIG = loadConfig();

/** Author/maintainer names allowed to appear in package metadata. */
export const ALLOWED_AUTHOR_NAMES = new Set(CONFIG.allowedAuthorNames);

/**
 * Structural email scanner. The dot-TLD is required so package specifiers and
 * field names such as `pkg@latest` / `ILR@CP` are not treated as email.
 */
export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * An email is allowed if it matches an exact allowlist entry, or its domain is
 * (or is a subdomain of) an allowed domain. Public docs should use only
 * non-deliverable RFC 2606 example domains; GitHub noreply is allowed because
 * npm/GitHub metadata can legitimately contain it.
 */
export function isAllowedEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (CONFIG.allowedEmails.some((e) => e.toLowerCase() === lower)) return true;
  const domain = lower.split("@").pop() ?? "";
  return CONFIG.allowedEmailDomains.some(
    (d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`),
  );
}

/**
 * Match absolute home paths broadly enough to catch real local paths. Example
 * docs may use a placeholder username (default `you`); those exact placeholders
 * are allowed because env files do not expand `~`, so absolute-path examples are
 * useful and deliberate.
 */
export const HOME_PATH_RE = /(?:\/Users\/[^\s"'`<>)]*|\/home\/[^\s"'`<>)]*|[A-Za-z]:\\Users\\[^\s"'`<>)]*)/g;

export function isAllowedHomePath(homePath: string): boolean {
  return CONFIG.placeholderUsernames.some(
    (u) =>
      new RegExp(`^/Users/${u}(?:/|$)`).test(homePath) ||
      new RegExp(`^/home/${u}(?:/|$)`).test(homePath) ||
      new RegExp(`^[A-Za-z]:\\\\Users\\\\${u}(?:\\\\|$)`).test(homePath),
  );
}

export function unexpectedHomePaths(text: string): string[] {
  return (text.match(HOME_PATH_RE) ?? []).filter((p) => !isAllowedHomePath(p));
}

export function loadForbiddenStrings(root: string = repoRoot): string[] | null {
  const file = join(root, FORBIDDEN_FILENAME);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
