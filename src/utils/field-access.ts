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
