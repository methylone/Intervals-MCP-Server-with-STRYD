// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Extract the same refine logic used in the tool definitions
const activityIdSchema = z
  .string()
  .min(1)
  .refine(
    (s) => !/\s/.test(s) && !/[^\x20-\x7E]/.test(s),
    "This looks like an activity name, not an ID. " +
    "Call get_activities first to get the activity_id field (e.g. 'i12345678')."
  );

describe("activity_id validation", () => {
  it("rejects activity names with spaces", () => {
    const result = activityIdSchema.safeParse("Easy Run");
    expect(result.success).toBe(false);
  });

  it("rejects Japanese activity names (non-ASCII)", () => {
    const result = activityIdSchema.safeParse("朝ジョグ");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = activityIdSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("accepts typical Intervals.icu activity ID", () => {
    const result = activityIdSchema.safeParse("i12345678");
    expect(result.success).toBe(true);
  });

  it("accepts alphanumeric string without 'i' prefix", () => {
    const result = activityIdSchema.safeParse("abc123");
    expect(result.success).toBe(true);
  });

  it("rejects name with tab character", () => {
    const result = activityIdSchema.safeParse("Morning\tRun");
    expect(result.success).toBe(false);
  });
});
