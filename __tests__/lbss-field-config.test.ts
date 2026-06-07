// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * v0.6.0 — LBSS field-name configuration.
 *
 * Covers:
 *  - readNumericField (the dynamic, type-safe field reader)
 *  - env resolution + CamelCase regex validation in config.ts
 *  - the default (StrydLBSSv2) and override precedence (arg > env > default)
 *  - include_legacy output shapes for get_weekly_summary and get_current_pmc
 *
 * The config tests use vi.resetModules() + a fresh dynamic import so each case
 * sees a clean (un-memoized) loadConfig; the handler tests run against the
 * statically-imported tools with the dummy creds npm test injects (LBSS_FIELD
 * is unset there, so the StrydLBSSv2 default is in effect).
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { readNumericField } from "../src/utils/field-access.js";
import type { Activity } from "../src/core/types.js";
import { intervalsClient } from "../src/core/intervals-client.js";
import { getWeeklySummaryTool } from "../src/extensions/stryd/tools/get-weekly-summary.js";
import { getCurrentPmcTool } from "../src/extensions/stryd/tools/get-current-pmc.js";
import { today, addDays } from "../src/utils/date.js";

// ─── readNumericField ────────────────────────────────────────────────────────

describe("readNumericField", () => {
  const base: Activity = {
    id: "a1",
    name: "Run",
    type: "Run",
    start_date_local: "2026-01-01T10:00:00",
    moving_time: 3600,
    distance: 10000,
  };

  it("number は値を返す", () => {
    expect(readNumericField({ ...base, StrydLBSSv2: 42 }, "StrydLBSSv2")).toBe(42);
    expect(readNumericField({ ...base, StrydLBSSv2: 0 }, "StrydLBSSv2")).toBe(0);
  });

  it("undefined（フィールド欠落）は null", () => {
    expect(readNumericField(base, "StrydLBSSv2")).toBeNull();
  });

  it("null は null", () => {
    expect(readNumericField({ ...base, StrydLBSSv2: null }, "StrydLBSSv2")).toBeNull();
  });

  it("string（非数値）は null", () => {
    expect(readNumericField({ ...base, StrydLBSSv2: "42" }, "StrydLBSSv2")).toBeNull();
  });
});

// ─── config: 解決優先順位 + regex 検証 ───────────────────────────────────────

describe("config — LBSS/ILR field env vars", () => {
  const CREDS = { INTERVALS_ATHLETE_ID: "i12345678", INTERVALS_API_KEY: "dummy" };

  /** Load a fresh config module with the given env overlaid on the creds. */
  async function loadFresh(overrides: Record<string, string | undefined>) {
    vi.resetModules();
    const saved = { ...process.env };
    try {
      // Strip any field vars the runner might carry, then apply this case's set.
      delete process.env.LBSS_FIELD;
      delete process.env.LBSS_FIELD_LEGACY;
      delete process.env.ILR_FIELD;
      Object.assign(process.env, CREDS, overrides);
      const mod = await import("../src/config.js");
      return mod.loadConfig();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  }

  afterEach(() => {
    vi.resetModules();
  });

  it("デフォルトは StrydLBSSv2 / StrydLBSSmod / StrydILR", async () => {
    const cfg = await loadFresh({});
    expect(cfg.lbssField).toBe("StrydLBSSv2");
    expect(cfg.lbssFieldLegacy).toBe("StrydLBSSmod");
    expect(cfg.ilrField).toBe("StrydILR");
  });

  it("env で上書きできる", async () => {
    const cfg = await loadFresh({
      LBSS_FIELD: "StrydLBSSmod",
      LBSS_FIELD_LEGACY: "OldLbss",
      ILR_FIELD: "MyIlr",
    });
    expect(cfg.lbssField).toBe("StrydLBSSmod");
    expect(cfg.lbssFieldLegacy).toBe("OldLbss");
    expect(cfg.ilrField).toBe("MyIlr");
  });

  it("underscore を含む名前は reject される（CamelCase 制約）", async () => {
    await expect(loadFresh({ LBSS_FIELD: "StrydLBSS_v2" })).rejects.toThrow(/LBSS_FIELD/);
  });

  it("空白を含む名前は reject される", async () => {
    await expect(loadFresh({ LBSS_FIELD: "Stryd LBSS" })).rejects.toThrow(/LBSS_FIELD/);
  });

  it("数字始まりの名前は reject される", async () => {
    await expect(loadFresh({ LBSS_FIELD: "2LBSS" })).rejects.toThrow(/LBSS_FIELD/);
  });
});

// ─── include_legacy 出力 shape ───────────────────────────────────────────────

function activityWithBoth(date: string, v2: number, mod: number): Activity {
  return {
    id: `act_${date}`,
    name: "Run",
    type: "Run",
    start_date_local: `${date}T10:00:00`,
    moving_time: 3600,
    distance: 10000,
    icu_training_load: 50,
    StrydLBSSv2: v2,
    StrydLBSSmod: mod,
    StrydILR: 8,
  };
}

describe("get_weekly_summary — include_legacy", () => {
  afterEach(() => vi.restoreAllMocks());

  const weekStart = "2026-06-01"; // Monday
  // v2 (default) and mod differ so the side-by-side values must not collapse.
  const acts = [activityWithBoth("2026-06-02", 30, 70)];

  it("既定では lbss を返し lbss_legacy は出さない", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({ week_start: weekStart })) as any;
    expect(r.totals.lbss).toBe(30); // StrydLBSSv2
    expect(r.totals).not.toHaveProperty("lbss_legacy");
    expect(r.sessions[0]).not.toHaveProperty("lbss_legacy");
    expect(r.pmc_end_of_week).not.toHaveProperty("lbss_legacy");
  });

  it("include_legacy=true で totals/sessions/PMC に lbss_legacy を併記する", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({
      week_start: weekStart,
      include_legacy: true,
    })) as any;

    expect(r.totals.lbss).toBe(30); // v2
    expect(r.totals.lbss_legacy).toBe(70); // mod
    expect(r.sessions[0].lbss).toBe(30);
    expect(r.sessions[0].lbss_legacy).toBe(70);
    expect(r.pmc_end_of_week.lbss_legacy).toEqual(
      expect.objectContaining({ ctl: expect.any(Number), atl: expect.any(Number), tsb: expect.any(Number) }),
    );
    // v2 と mod は別フィールド → PMC も別の数値
    expect(r.pmc_end_of_week.lbss.ctl).not.toBe(r.pmc_end_of_week.lbss_legacy.ctl);
  });

  it("lbss_field 引数で primary フィールドを上書きできる", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({
      week_start: weekStart,
      lbss_field: "StrydLBSSmod",
    })) as any;
    expect(r.totals.lbss).toBe(70); // override → mod value
  });
});

describe("get_current_pmc — include_legacy", () => {
  afterEach(() => vi.restoreAllMocks());

  // An activity inside the 180-day window so both EMAs are non-zero.
  const recent = () => [activityWithBoth(addDays(today("UTC"), -1), 30, 70)];

  it("既定では lbss_legacy を出さない", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(recent());
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getCurrentPmcTool.handler({})) as any;
    expect(r.lbss).toEqual(
      expect.objectContaining({ ctl: expect.any(Number), atl: expect.any(Number), tsb: expect.any(Number) }),
    );
    expect(r).not.toHaveProperty("lbss_legacy");
  });

  it("include_legacy=true で lbss_legacy (ctl/atl/tsb) を返す", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(recent());
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getCurrentPmcTool.handler({ include_legacy: true })) as any;
    expect(r.lbss_legacy).toEqual(
      expect.objectContaining({ ctl: expect.any(Number), atl: expect.any(Number), tsb: expect.any(Number) }),
    );
    // v2 ≠ mod なので併記値は異なる
    expect(r.lbss.ctl).not.toBe(r.lbss_legacy.ctl);
  });
});
