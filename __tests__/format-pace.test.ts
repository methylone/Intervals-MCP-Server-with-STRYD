// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { formatPace } from "../src/core/tools/search-similar-activities.js";

describe("formatPace", () => {
  // Helper: pass secPerKm directly by using distance=1000m
  const pace = (secPerKm: number) => formatPace(secPerKm, 1000);

  it("returns null for zero distance", () => {
    expect(formatPace(300, 0)).toBeNull();
  });

  it("returns null for negative distance", () => {
    expect(formatPace(300, -100)).toBeNull();
  });

  it("formats normal pace correctly", () => {
    expect(pace(330)).toBe("5:30");
    expect(pace(270)).toBe("4:30");
  });

  it("pads single-digit seconds with leading zero", () => {
    expect(pace(305)).toBe("5:05");
    expect(pace(300)).toBe("5:00");
  });

  it("handles carry-over when rounding seconds to 60 (359.5 sec/km)", () => {
    // 359.5 / 60 → floor = 5, 359.5 % 60 = 59.5 → round = 60
    // Without fix: "5:60" (bug). With fix: "6:00"
    expect(pace(359.5)).toBe("6:00");
  });

  it("handles carry-over when rounding seconds to 60 (299.5 sec/km)", () => {
    // 299.5 / 60 → floor = 4, 299.5 % 60 = 59.5 → round = 60
    // Without fix: "4:60" (bug). With fix: "5:00"
    expect(pace(299.5)).toBe("5:00");
  });

  it("formats exact minute boundary correctly (360.0 sec/km)", () => {
    // 360.0 / 60 = 6, 360.0 % 60 = 0 → "6:00"
    expect(pace(360.0)).toBe("6:00");
  });
});
