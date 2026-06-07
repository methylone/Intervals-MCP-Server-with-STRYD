// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PII guard — distribution metadata (#14.4).
 *
 * package.json and manifest.json are published verbatim. This test asserts:
 *   - author / contributors / maintainers carry no name other than "methylone"
 *     (or are absent entirely);
 *   - no email-like string appears outside the allowlist (GitHub noreply / RFC 2606 examples);
 *   - none of the optional `.pii-forbidden` literals appear (deep check; skipped
 *     when the deny-list file is absent — see __tests__/helpers/pii.ts).
 *
 * Runs in `npm test`, so prepublishOnly gates publish on it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EMAIL_RE, isAllowedEmail, loadForbiddenStrings } from "./helpers/pii.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const ALLOWED_NAMES = new Set(["methylone"]);
const FILES = ["package.json", "manifest.json"] as const;

function readJson(name: string): { raw: string; data: Record<string, unknown> } {
  const raw = readFileSync(join(repoRoot, name), "utf-8");
  return { raw, data: JSON.parse(raw) as Record<string, unknown> };
}

/** Assert a "person" value (string or {name,email}) carries no unexpected name/email. */
function checkPerson(person: unknown, where: string): void {
  if (person == null) return;
  if (typeof person === "string") {
    // npm "Name <email> (url)" shorthand.
    const m = person.match(/^([^<(]*?)\s*(?:<([^>]+)>)?\s*(?:\(([^)]+)\))?$/);
    const name = (m?.[1] ?? person).trim();
    if (name) {
      expect(ALLOWED_NAMES.has(name), `${where}: unexpected name "${name}"`).toBe(true);
    }
    const email = m?.[2];
    if (email) {
      expect(isAllowedEmail(email), `${where}: unexpected email "${email}"`).toBe(true);
    }
    return;
  }
  if (typeof person === "object") {
    const p = person as { name?: unknown; email?: unknown };
    if (typeof p.name === "string") {
      expect(ALLOWED_NAMES.has(p.name), `${where}: unexpected name "${p.name}"`).toBe(true);
    }
    if (typeof p.email === "string") {
      expect(
        isAllowedEmail(p.email),
        `${where}: unexpected email "${p.email}"`,
      ).toBe(true);
    }
  }
}

describe("distribution metadata PII guard", () => {
  for (const file of FILES) {
    describe(file, () => {
      it("author/contributors/maintainers carry no unexpected name or email", () => {
        const { data } = readJson(file);
        checkPerson(data.author, `${file} author`);
        for (const key of ["contributors", "maintainers"] as const) {
          const list = data[key];
          if (Array.isArray(list)) {
            list.forEach((person, i) => checkPerson(person, `${file} ${key}[${i}]`));
          } else if (list != null) {
            checkPerson(list, `${file} ${key}`);
          }
        }
      });

      it("contains no email-like string outside the allowlist", () => {
        const { raw } = readJson(file);
        const emails = raw.match(EMAIL_RE) ?? [];
        const offenders = emails.filter((e) => !isAllowedEmail(e));
        expect(offenders, `${file}: unexpected email(s) ${offenders.join(", ")}`).toEqual([]);
      });
    });
  }

  it("contains none of the .pii-forbidden literals (deep check, optional)", () => {
    const forbidden = loadForbiddenStrings(repoRoot);
    if (forbidden === null) {
      // No deny-list on this machine (public clone / fresh checkout) — skip.
      return;
    }
    expect(forbidden.length, ".pii-forbidden exists but is empty").toBeGreaterThan(0);
    for (const file of FILES) {
      const { raw } = readJson(file);
      for (const needle of forbidden) {
        expect(raw.includes(needle), `${file} contains forbidden literal`).toBe(false);
      }
    }
  });
});

describe("email allowlist rules", () => {
  it("requires a dot-TLD before treating text as an email", () => {
    expect("pkg@latest ILR@CP".match(EMAIL_RE)).toBeNull();
  });

  it("allows GitHub noreply and RFC 2606 example domains only", () => {
    expect(isAllowedEmail("person@users.noreply.github.com")).toBe(true);
    expect(isAllowedEmail("person@example.com")).toBe(true);
    expect(isAllowedEmail("person@example.org")).toBe(true);
    expect(isAllowedEmail("person@example.net")).toBe(true);
    expect(isAllowedEmail("person@runner.test")).toBe(true);
    expect(isAllowedEmail("person@runner.invalid")).toBe(true);
    expect(isAllowedEmail("person@runner.example")).toBe(true);

    expect(isAllowedEmail("person@example.co")).toBe(false);
    expect(isAllowedEmail("person@real-domain.tld")).toBe(false);
  });
});
