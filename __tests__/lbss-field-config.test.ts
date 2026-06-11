// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * v0.6.0 — LBSS field-name configuration.
 *
 * Covers:
 *  - readNumericField (the dynamic, type-safe field reader)
 *  - env resolution + CamelCase regex validation in config.ts
 *  - the default (StrydLBSSv2) and override precedence (arg > env > default)
 *  - include_ecc output shapes for get_weekly_summary
 *  - absence of lbss_legacy keys (include_legacy removed in v0.11)
 *
 * The config tests use vi.resetModules() + a fresh dynamic import so each case
 * sees a clean (un-memoized) loadConfig; the handler tests run against the
 * statically-imported tools with the dummy creds npm test injects (LBSS_FIELD
 * is unset there, so the StrydLBSSv2 default is in effect).
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { readNumericField, resolveEccField } from "../src/utils/field-access.js";
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

// ─── resolveEccField (include_ecc の有効/無効ガード) ─────────────────────────

describe("resolveEccField", () => {
  it("非空フィールド名はそのまま返す", () => {
    expect(resolveEccField("EccLBSS")).toBe("EccLBSS");
  });

  it("空文字（無効）は明示エラーで throw する", () => {
    expect(() => resolveEccField("")).toThrow(/ECC_FIELD is disabled/);
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
      delete process.env.ILR_FIELD;
      delete process.env.ECC_FIELD;
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

  it("デフォルトは StrydLBSSv2 / StrydILR", async () => {
    const cfg = await loadFresh({});
    expect(cfg.lbssField).toBe("StrydLBSSv2");
    expect(cfg.ilrField).toBe("StrydILR");
  });

  it("lbssFieldLegacy プロパティは存在しない（v0.11 削除）", async () => {
    const cfg = await loadFresh({});
    expect(cfg).not.toHaveProperty("lbssFieldLegacy");
  });

  it("ECC_FIELD のデフォルトは EccLBSS", async () => {
    const cfg = await loadFresh({});
    expect(cfg.eccField).toBe("EccLBSS");
  });

  it("ECC_FIELD='' は機能無効（空文字を許容）", async () => {
    const cfg = await loadFresh({ ECC_FIELD: "" });
    expect(cfg.eccField).toBe("");
  });

  it("ECC_FIELD の非空・不正名は reject される", async () => {
    await expect(loadFresh({ ECC_FIELD: "Ecc LBSS" })).rejects.toThrow(/ECC_FIELD/);
    await expect(loadFresh({ ECC_FIELD: "Ecc_LBSS" })).rejects.toThrow(/ECC_FIELD/);
  });

  it("env で上書きできる", async () => {
    const cfg = await loadFresh({
      LBSS_FIELD: "StrydLBSSmod",
      ILR_FIELD: "MyIlr",
    });
    expect(cfg.lbssField).toBe("StrydLBSSmod");
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

// ─── include_legacy 引退: lbss_legacy キー不在 ────────────────────────────────

function makeActivity(date: string, v2: number, ecc?: number): Activity {
  return {
    id: `act_${date}`,
    name: "Run",
    type: "Run",
    start_date_local: `${date}T10:00:00`,
    moving_time: 3600,
    distance: 10000,
    icu_training_load: 50,
    StrydLBSSv2: v2,
    StrydILR: 8,
    ...(ecc !== undefined ? { EccLBSS: ecc } : {}),
  };
}

describe("get_weekly_summary — lbss_legacy キーは存在しない（v0.11 削除）", () => {
  afterEach(() => vi.restoreAllMocks());

  const weekStart = "2026-06-01";
  const acts = [makeActivity("2026-06-02", 30)];

  it("totals / sessions / pmc_end_of_week に lbss_legacy キーが出ない", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({ week_start: weekStart })) as any;
    expect(r.totals).not.toHaveProperty("lbss_legacy");
    expect(r.sessions[0]).not.toHaveProperty("lbss_legacy");
    expect(r.pmc_end_of_week).not.toHaveProperty("lbss_legacy");
  });

  it("include_legacy: true を渡してもエラーにならず無視される（Zod strip）", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({
      week_start: weekStart,
      include_legacy: true,
    } as any)) as any;
    // Zod strips unknown keys — no error, no lbss_legacy in output
    expect(r.totals).not.toHaveProperty("lbss_legacy");
  });

  it("lbss_field 引数で primary フィールドを上書きできる", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue([makeActivity("2026-06-02", 30)]);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({
      week_start: weekStart,
      lbss_field: "StrydLBSSv2",
    })) as any;
    expect(r.totals.lbss).toBe(30);
  });
});

describe("get_weekly_summary — include_ecc", () => {
  afterEach(() => vi.restoreAllMocks());

  const weekStart = "2026-06-01";
  const acts = [makeActivity("2026-06-02", 30, 90)];

  it("既定では ecc を出さない", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({ week_start: weekStart })) as any;
    expect(r.totals).not.toHaveProperty("ecc");
    expect(r.sessions[0]).not.toHaveProperty("ecc");
  });

  it("include_ecc=true で totals.ecc / sessions[].ecc を EccLBSS から併記する", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getWeeklySummaryTool.handler({
      week_start: weekStart,
      include_ecc: true,
    })) as any;
    expect(r.totals.ecc).toBe(90);
    expect(r.sessions[0].ecc).toBe(90);
    expect(r.pmc_end_of_week).not.toHaveProperty("ecc");
  });

  it("equivalence: include_ecc=true の totals.ecc == lbss_field=EccLBSS の totals.lbss", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);
    const viaEcc = (await getWeeklySummaryTool.handler({ week_start: weekStart, include_ecc: true })) as any;

    vi.restoreAllMocks();
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(acts);
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);
    const viaOverride = (await getWeeklySummaryTool.handler({ week_start: weekStart, lbss_field: "EccLBSS" })) as any;

    expect(viaEcc.totals.ecc).toBe(viaOverride.totals.lbss);
  });
});

describe("get_current_pmc — lbss_legacy キーは存在しない（v0.11 削除）", () => {
  afterEach(() => vi.restoreAllMocks());

  const recent = () => [makeActivity(addDays(today("UTC"), -1), 30)];

  it("lbss キーあり、lbss_legacy キーなし", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(recent());
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getCurrentPmcTool.handler({})) as any;
    expect(r.lbss).toEqual(
      expect.objectContaining({ ctl: expect.any(Number), atl: expect.any(Number), tsb: expect.any(Number) }),
    );
    expect(r).not.toHaveProperty("lbss_legacy");
  });

  it("include_legacy: true を渡してもエラーにならず無視される（Zod strip）", async () => {
    vi.spyOn(intervalsClient, "getActivities").mockResolvedValue(recent());
    vi.spyOn(intervalsClient, "getWellness").mockResolvedValue([]);

    const r = (await getCurrentPmcTool.handler({ include_legacy: true } as any)) as any;
    expect(r).not.toHaveProperty("lbss_legacy");
  });
});
