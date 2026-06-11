// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Dynamic, type-safe access to numeric custom fields on an Activity.
 *
 * The Stryd aggregation tools read fields whose names are configurable at
 * runtime (env / per-call override), so the field cannot be a static property
 * reference. `Activity` is intersected with `Record<string, unknown>`, so
 * `a[field]` type-checks without a cast.
 */
import type { Activity } from "../core/types.js";

/**
 * Return the value of `a[field]` when it is a number, otherwise null.
 * undefined / null / string / any non-number all map to null — the same
 * shape the previous `typeof a.StrydLBSSmod === "number"` guards produced.
 */
export function readNumericField(a: Activity, field: string): number | null {
  const value = a[field];
  return typeof value === "number" ? value : null;
}

/**
 * Resolve the Ecc field for an include_ecc=true call, throwing a clear error when
 * the feature is disabled (ECC_FIELD set to ""). Mirrors the fail-fast posture of
 * the field-name regex checks: a misconfiguration surfaces immediately rather than
 * silently omitting the ecc output. Returns the field name when enabled.
 */
export function resolveEccField(eccField: string): string {
  if (eccField === "") {
    throw new Error(
      "include_ecc=true but ECC_FIELD is disabled (empty). Set ECC_FIELD to your " +
        "eccentric-LBSS custom-field code (e.g. EccLBSS) to enable it.",
    );
  }
  return eccField;
}
