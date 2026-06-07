// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared PII-guard helpers.
 *
 * `loadForbiddenStrings` reads an OPTIONAL, gitignored deny-list of literal
 * strings that must never appear in published artifacts (the maintainer's real
 * name, real email, home path, etc.). The file is intentionally NOT committed
 * and is excluded from the public snapshot — keeping the real PII literals out
 * of the public test code, which would otherwise become a leak source itself.
 *
 * Contract: one forbidden literal per line; blank lines and `#` comments are
 * ignored. Returns null when the file is absent (public clones / fresh checkouts
 * skip the deep check; the structural checks still run unconditionally).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FORBIDDEN_FILENAME = ".pii-forbidden";

/**
 * Structural email scanner. The dot-TLD is required so package specifiers and
 * field names such as `pkg@latest` / `ILR@CP` are not treated as email.
 */
export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Public docs may use only non-deliverable RFC 2606-style example domains.
 * GitHub noreply is also allowed because npm/GitHub metadata can contain it.
 */
export function isAllowedEmail(email: string): boolean {
  const domain = email.split("@").pop()?.toLowerCase() ?? "";
  return (
    domain === "users.noreply.github.com" ||
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain === "test" ||
    domain.endsWith(".test") ||
    domain === "invalid" ||
    domain.endsWith(".invalid") ||
    domain === "example" ||
    domain.endsWith(".example")
  );
}

/**
 * Match absolute home paths broadly enough to catch real local paths. Example
 * docs may use username `you`; that exact placeholder is allowed because env
 * files do not expand `~`, so absolute-path examples are useful and deliberate.
 */
export const HOME_PATH_RE = /(?:\/Users\/[^\s"'`<>)]*|\/home\/[^\s"'`<>)]*|[A-Za-z]:\\Users\\[^\s"'`<>)]*)/g;

export function isAllowedHomePath(homePath: string): boolean {
  return (
    /^\/Users\/you(?:\/|$)/.test(homePath) ||
    /^\/home\/you(?:\/|$)/.test(homePath) ||
    /^[A-Za-z]:\\Users\\you(?:\\|$)/.test(homePath)
  );
}

export function unexpectedHomePaths(text: string): string[] {
  return (text.match(HOME_PATH_RE) ?? []).filter((p) => !isAllowedHomePath(p));
}

export function loadForbiddenStrings(repoRoot: string): string[] | null {
  const file = join(repoRoot, FORBIDDEN_FILENAME);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
