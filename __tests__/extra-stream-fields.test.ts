// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * EXTRA_STREAM_FIELDS — config parsing and streams-summary extras output.
 *
 * Covers:
 *  - config: unset → [], valid list → parsed/deduped, invalid code → throw,
 *    ILR_FIELD duplicate → deduped out
 *  - streams summary: extras present in output when configured, absent when not,
 *    missing stream code → null in output, extra_streams_present list
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getStreamsSummaryTool } from "../src/core/tools/get-streams-summary.js";
import { setCacheEnabled } from "../src/core/cache.js";

// ─── config: EXTRA_STREAM_FIELDS parsing ─────────────────────────────────────

describe("config — EXTRA_STREAM_FIELDS", () => {
  const CREDS = { INTERVALS_ATHLETE_ID: "i12345678", INTERVALS_API_KEY: "dummy" };

  async function loadFresh(overrides: Record<string, string | undefined>) {
    vi.resetModules();
    const saved = { ...process.env };
    try {
      delete process.env.EXTRA_STREAM_FIELDS;
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

  it("未設定 → extraStreamFields は空配列", async () => {
    const cfg = await loadFresh({});
    expect(cfg.extraStreamFields).toEqual([]);
  });

  it("空文字 → extraStreamFields は空配列", async () => {
    const cfg = await loadFresh({ EXTRA_STREAM_FIELDS: "" });
    expect(cfg.extraStreamFields).toEqual([]);
  });

  it("スペース区切りあり → trim して2要素", async () => {
    const cfg = await loadFresh({ EXTRA_STREAM_FIELDS: "StrydLSS, StrydTemp" });
    expect(cfg.extraStreamFields).toEqual(["StrydLSS", "StrydTemp"]);
  });

  it("3要素を正しく分割", async () => {
    const cfg = await loadFresh({ EXTRA_STREAM_FIELDS: "StrydLSS,StrydTemp,StrydHumidity" });
    expect(cfg.extraStreamFields).toEqual(["StrydLSS", "StrydTemp", "StrydHumidity"]);
  });

  it("ILR_FIELD と重複するコードはデデュープされる", async () => {
    // ILR_FIELD default = StrydILR; include it in the list
    const cfg = await loadFresh({ EXTRA_STREAM_FIELDS: "StrydLSS,StrydILR,StrydTemp" });
    expect(cfg.extraStreamFields).not.toContain("StrydILR");
    expect(cfg.extraStreamFields).toEqual(["StrydLSS", "StrydTemp"]);
  });

  it("リスト内の重複も除去される", async () => {
    const cfg = await loadFresh({ EXTRA_STREAM_FIELDS: "StrydLSS,StrydLSS,StrydTemp" });
    expect(cfg.extraStreamFields).toEqual(["StrydLSS", "StrydTemp"]);
  });

  it("スペースを含むコードは reject される", async () => {
    await expect(loadFresh({ EXTRA_STREAM_FIELDS: "Stryd LSS" })).rejects.toThrow(
      /EXTRA_STREAM_FIELDS/,
    );
  });

  it("アンダースコアを含むコードは reject される", async () => {
    await expect(loadFresh({ EXTRA_STREAM_FIELDS: "Stryd_LSS" })).rejects.toThrow(
      /EXTRA_STREAM_FIELDS/,
    );
  });

  it("数字始まりのコードは reject される", async () => {
    await expect(loadFresh({ EXTRA_STREAM_FIELDS: "1StrydLSS" })).rejects.toThrow(
      /EXTRA_STREAM_FIELDS/,
    );
  });
});

// ─── streams summary: extras in output ───────────────────────────────────────

type Stream = { type: string; data: (number | null)[] };

function stubStreams(streams: Stream[], detail: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) => {
      const u = String(url);
      const body = u.includes("/streams") ? streams : detail;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

function baseStreams(extras: Stream[] = []): Stream[] {
  const n = 10;
  return [
    { type: "time", data: Array.from({ length: n }, (_, i) => i) },
    { type: "velocity_smooth", data: new Array(n).fill(3) },
    { type: "distance", data: Array.from({ length: n }, (_, i) => i * 3) },
    { type: "fixed_heartrate", data: new Array(n).fill(150) },
    ...extras,
  ];
}

const callArgs = {
  activity_id: "i999",
  split_method: "halves" as const,
  warmup_exclude_sec: 0,
  post_stop_buffer_sec: 30,
};

beforeEach(() => setCacheEnabled(false));
afterEach(() => {
  setCacheEnabled(true);
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("streams summary — extras (EXTRA_STREAM_FIELDS not configured)", () => {
  it("EXTRA_STREAM_FIELDS 未設定 → extras キーなし / extra_streams_present キーなし", async () => {
    // Explicitly clear EXTRA_STREAM_FIELDS (the dev .env may have it set) and
    // re-import so the config module sees an empty value.
    const prev = process.env.EXTRA_STREAM_FIELDS;
    delete process.env.EXTRA_STREAM_FIELDS;
    vi.resetModules();
    try {
      stubStreams(baseStreams(), { name: "Test", has_weather: false });
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      const out = (await tool.handler(callArgs)) as Record<string, unknown>;

      expect(out.overall).not.toHaveProperty("extras");
      expect(out.data_quality).not.toHaveProperty("extra_streams_present");
      const splits = out.splits as Array<Record<string, unknown>>;
      for (const sp of splits) {
        expect(sp).not.toHaveProperty("extras");
      }
    } finally {
      if (prev !== undefined) process.env.EXTRA_STREAM_FIELDS = prev;
      vi.resetModules();
    }
  });
});

describe("streams summary — extras (with EXTRA_STREAM_FIELDS configured)", () => {
  // Override extraStreamFields by patching config_ via resetModules + re-import,
  // then re-import the tool so it picks up the new config.

  async function runWithExtras(
    extraCodes: string[],
    streamData: Record<string, (number | null)[]>,
  ) {
    // Patch process.env before resetting modules so the re-imported config sees it.
    const prev = process.env.EXTRA_STREAM_FIELDS;
    process.env.EXTRA_STREAM_FIELDS = extraCodes.join(",");
    vi.resetModules();
    try {
      const extraStreams: Stream[] = extraCodes.map((code) => ({
        type: code,
        data: streamData[code] ?? new Array(10).fill(null),
      }));
      stubStreams(baseStreams(extraStreams), { name: "Test", has_weather: false });
      // Disable cache on the freshly-imported module instance so disk files
      // from prior test runs don't interfere.
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      return (await tool.handler(callArgs)) as Record<string, unknown>;
    } finally {
      if (prev === undefined) delete process.env.EXTRA_STREAM_FIELDS;
      else process.env.EXTRA_STREAM_FIELDS = prev;
      vi.resetModules();
    }
  }

  it("configured extras: splits/overall に extras が出る、小数2桁丸め", async () => {
    // StrydLSS: 10 values of 9.5 → avg = 9.5
    const lssData = new Array(10).fill(9.5);
    const out = await runWithExtras(["StrydLSS"], { StrydLSS: lssData });

    const overall = out.overall as Record<string, unknown>;
    expect(overall).toHaveProperty("extras");
    expect((overall.extras as Record<string, unknown>).StrydLSS).toBe(9.5);

    const splits = out.splits as Array<Record<string, unknown>>;
    expect(splits.length).toBeGreaterThanOrEqual(2);
    for (const sp of splits) {
      expect(sp).toHaveProperty("extras");
      expect((sp.extras as Record<string, unknown>).StrydLSS).toBeTypeOf("number");
    }

    const dq = out.data_quality as Record<string, unknown>;
    expect(dq).toHaveProperty("extra_streams_present");
    expect(dq.extra_streams_present).toContain("StrydLSS");
  });

  it("API が code を返さない場合: extras の値は null, extra_streams_present に含まれない", async () => {
    // Configure StrydTemp but pass empty streamData so the stub response
    // does NOT include a StrydTemp stream entry at all.
    const prev = process.env.EXTRA_STREAM_FIELDS;
    process.env.EXTRA_STREAM_FIELDS = "StrydTemp";
    vi.resetModules();
    try {
      // Stub with no StrydTemp stream in the response
      stubStreams(baseStreams([]), { name: "Test", has_weather: false });
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      const out = (await tool.handler(callArgs)) as Record<string, unknown>;

      const overall = out.overall as Record<string, unknown>;
      expect((overall.extras as Record<string, unknown>).StrydTemp).toBeNull();

      const dq = out.data_quality as Record<string, unknown>;
      expect(dq.extra_streams_present).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.EXTRA_STREAM_FIELDS;
      else process.env.EXTRA_STREAM_FIELDS = prev;
      vi.resetModules();
    }
  });

  it("複数 extras: 全て出力される", async () => {
    const out = await runWithExtras(
      ["StrydLSS", "StrydTemp"],
      { StrydLSS: new Array(10).fill(10.0), StrydTemp: new Array(10).fill(30.0) },
    );

    const overall = out.overall as Record<string, unknown>;
    const extras = overall.extras as Record<string, unknown>;
    expect(extras.StrydLSS).toBe(10.0);
    expect(extras.StrydTemp).toBe(30.0);
    expect((out.data_quality as Record<string, unknown>).extra_streams_present).toEqual(
      expect.arrayContaining(["StrydLSS", "StrydTemp"]),
    );
  });
});
