// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * run-gated extras — buildRunMask, countInRange, and streams-summary
 * run_fraction / extras_run output.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  buildRunMask,
  countInRange,
  DEFAULT_RUN_GATE_CADENCE_RPM,
} from "../src/utils/stream-processing.js";
import { getStreamsSummaryTool } from "../src/core/tools/get-streams-summary.js";
import { setCacheEnabled } from "../src/core/cache.js";

// ─── buildRunMask ─────────────────────────────────────────────────────────────

describe("buildRunMask", () => {
  it("DEFAULT_RUN_GATE_CADENCE_RPM は 70", () => {
    expect(DEFAULT_RUN_GATE_CADENCE_RPM).toBe(70);
  });

  it("cadence null → false", () => {
    const mask = buildRunMask([true], [null], 70);
    expect(mask[0]).toBe(false);
  });

  it("cadence < threshold → false", () => {
    const mask = buildRunMask([true], [60], 70);
    expect(mask[0]).toBe(false);
  });

  it("cadence = threshold → true（境界は inclusive）", () => {
    const mask = buildRunMask([true], [70], 70);
    expect(mask[0]).toBe(true);
  });

  it("cadence > threshold → true", () => {
    const mask = buildRunMask([true], [85], 70);
    expect(mask[0]).toBe(true);
  });

  it("validMask false → false（cadence 値に関わらず）", () => {
    const mask = buildRunMask([false], [90], 70);
    expect(mask[0]).toBe(false);
  });

  it("runMask ⊆ validMask: validMask=false の点は runMask も false", () => {
    const valid = [true, false, true, true];
    const cadence: (number | null)[] = [80, 80, 60, 80];
    const run = buildRunMask(valid, cadence, 70);
    expect(run).toEqual([true, false, false, true]);
  });
});

// ─── countInRange ─────────────────────────────────────────────────────────────

describe("countInRange", () => {
  it("全て true → end - start + 1", () => {
    expect(countInRange([true, true, true, true], 0, 3)).toBe(4);
  });

  it("全て false → 0", () => {
    expect(countInRange([false, false, false], 0, 2)).toBe(0);
  });

  it("部分範囲を数える", () => {
    expect(countInRange([true, false, true, true, false], 1, 3)).toBe(2);
  });

  it("start = end = true → 1", () => {
    expect(countInRange([true, true, true], 1, 1)).toBe(1);
  });
});

// ─── streams summary — run_fraction / extras_run integration ─────────────────

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

/** 120サンプル: 前半60 walk (cadence=60)、後半60 run (cadence=85).
 *  extra stream: walk=3.0, run=8.0 → extras overall avg = 5.5, extras_run = 8.0.
 *  60 run samples meets the min-sample guard threshold (< 60 → null). */
function mixedStreams(extraCode = "StrydLSS"): Stream[] {
  const n = 120;
  const cadence = [
    ...new Array(60).fill(60),  // walk
    ...new Array(60).fill(85),  // run
  ];
  const extraData = [
    ...new Array(60).fill(3.0),  // walk samples
    ...new Array(60).fill(8.0),  // run samples
  ];
  return [
    { type: "time", data: Array.from({ length: n }, (_, i) => i) },
    { type: "velocity_smooth", data: new Array(n).fill(3) },
    { type: "distance", data: Array.from({ length: n }, (_, i) => i * 3) },
    { type: "fixed_heartrate", data: new Array(n).fill(150) },
    { type: "cadence", data: cadence },
    { type: extraCode, data: extraData },
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

async function runWithConfig(env: Record<string, string>, args = callArgs) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  try {
    const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
    setCache(false);
    const { getStreamsSummaryTool: tool } = await import(
      "../src/core/tools/get-streams-summary.js"
    );
    return (await tool.handler(args)) as Record<string, unknown>;
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    vi.resetModules();
  }
}

describe("streams summary — run_fraction + extras_run (cadence present)", () => {
  it("run_fraction = 0.5（走行10/総計20）、extras overall ≈ 5.5、extras_run = 8.0", async () => {
    process.env.EXTRA_STREAM_FIELDS = "StrydLSS";
    vi.resetModules();
    try {
      stubStreams(mixedStreams("StrydLSS"), { name: "Test", has_weather: false });
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      const out = (await tool.handler(callArgs)) as Record<string, unknown>;

      const overall = out.overall as Record<string, unknown>;
      expect(overall.run_fraction).toBe(0.5);
      // extras overall includes both walk (3.0) and run (8.0) → avg = 5.5
      expect((overall.extras as Record<string, unknown>).StrydLSS).toBe(5.5);
      // extras_run includes only run samples (8.0)
      expect((overall.extras_run as Record<string, unknown>).StrydLSS).toBe(8.0);

      const dq = out.data_quality as Record<string, unknown>;
      expect(dq.run_gate_cadence_rpm).toBe(70);
    } finally {
      delete process.env.EXTRA_STREAM_FIELDS;
      vi.resetModules();
    }
  });

  it("cadence ストリーム不在 → run_fraction / extras_run / run_gate_cadence_rpm キー不在", async () => {
    process.env.EXTRA_STREAM_FIELDS = "StrydLSS";
    vi.resetModules();
    try {
      // Build streams WITHOUT cadence
      const n = 10;
      const noCadenceStreams: Stream[] = [
        { type: "time", data: Array.from({ length: n }, (_, i) => i) },
        { type: "velocity_smooth", data: new Array(n).fill(3) },
        { type: "distance", data: Array.from({ length: n }, (_, i) => i * 3) },
        { type: "fixed_heartrate", data: new Array(n).fill(150) },
        { type: "StrydLSS", data: new Array(n).fill(8.0) },
      ];
      stubStreams(noCadenceStreams, { name: "Test", has_weather: false });
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      const out = (await tool.handler(callArgs)) as Record<string, unknown>;

      const overall = out.overall as Record<string, unknown>;
      expect(overall).not.toHaveProperty("run_fraction");
      expect(overall).not.toHaveProperty("extras_run");
      const dq = out.data_quality as Record<string, unknown>;
      expect(dq).not.toHaveProperty("run_gate_cadence_rpm");

      const splits = out.splits as Array<Record<string, unknown>>;
      for (const sp of splits) {
        expect(sp).not.toHaveProperty("run_fraction");
        expect(sp).not.toHaveProperty("extras_run");
      }
    } finally {
      delete process.env.EXTRA_STREAM_FIELDS;
      vi.resetModules();
    }
  });

  it("少数サンプルガード: split の走行サンプル < 60 → extras_run 全コード null（run_fraction は出る）", async () => {
    // Use 10 total samples (< 60 run threshold) to trigger the guard.
    process.env.EXTRA_STREAM_FIELDS = "StrydLSS";
    vi.resetModules();
    try {
      // 10 samples, all cadence = 85 (all running). run count = 10 < 60 guard.
      const n = 10;
      const smallStreams: Stream[] = [
        { type: "time", data: Array.from({ length: n }, (_, i) => i) },
        { type: "velocity_smooth", data: new Array(n).fill(3) },
        { type: "distance", data: Array.from({ length: n }, (_, i) => i * 3) },
        { type: "fixed_heartrate", data: new Array(n).fill(150) },
        { type: "cadence", data: new Array(n).fill(85) },
        { type: "StrydLSS", data: new Array(n).fill(9.0) },
      ];
      stubStreams(smallStreams, { name: "Test", has_weather: false });
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      const out = (await tool.handler(callArgs)) as Record<string, unknown>;

      // overall: 10 run samples < 60 → extras_run null
      const overall = out.overall as Record<string, unknown>;
      expect(overall).toHaveProperty("run_fraction");
      expect((overall.extras_run as Record<string, unknown>).StrydLSS).toBeNull();

      // each split: also < 60 running samples → extras_run null
      const splits = out.splits as Array<Record<string, unknown>>;
      for (const sp of splits) {
        expect(sp).toHaveProperty("run_fraction");
        expect((sp.extras_run as Record<string, unknown>).StrydLSS).toBeNull();
      }
    } finally {
      delete process.env.EXTRA_STREAM_FIELDS;
      vi.resetModules();
    }
  });

  it("run_gate_cadence_rpm 上書きが反映される", async () => {
    process.env.EXTRA_STREAM_FIELDS = "StrydLSS";
    vi.resetModules();
    try {
      // cadence all 80, gate at 85 → all samples are walk under the higher threshold
      const n = 20;
      const streams: Stream[] = [
        { type: "time", data: Array.from({ length: n }, (_, i) => i) },
        { type: "velocity_smooth", data: new Array(n).fill(3) },
        { type: "distance", data: Array.from({ length: n }, (_, i) => i * 3) },
        { type: "fixed_heartrate", data: new Array(n).fill(150) },
        { type: "cadence", data: new Array(n).fill(80) },
        { type: "StrydLSS", data: new Array(n).fill(9.0) },
      ];
      stubStreams(streams, { name: "Test", has_weather: false });
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      const out = (await tool.handler({
        ...callArgs,
        run_gate_cadence_rpm: 85, // stricter gate: 80 rpm all become walk
      })) as Record<string, unknown>;

      const overall = out.overall as Record<string, unknown>;
      expect(overall.run_fraction).toBe(0); // no samples pass the 85 rpm gate

      const dq = out.data_quality as Record<string, unknown>;
      expect(dq.run_gate_cadence_rpm).toBe(85);
    } finally {
      delete process.env.EXTRA_STREAM_FIELDS;
      vi.resetModules();
    }
  });

  it("EXTRA_STREAM_FIELDS 未設定でも run_fraction は出る（cadence あり）", async () => {
    // Explicitly clear EXTRA_STREAM_FIELDS so the re-imported config sees no extras.
    const prev = process.env.EXTRA_STREAM_FIELDS;
    delete process.env.EXTRA_STREAM_FIELDS;
    vi.resetModules();
    try {
      stubStreams(mixedStreams("StrydLSS"), { name: "Test", has_weather: false });
      const { setCacheEnabled: setCache } = await import("../src/core/cache.js");
      setCache(false);
      const { getStreamsSummaryTool: tool } = await import(
        "../src/core/tools/get-streams-summary.js"
      );
      const out = (await tool.handler(callArgs)) as Record<string, unknown>;
      const overall = out.overall as Record<string, unknown>;
      // cadence stream is present → run_fraction should be emitted
      expect(overall).toHaveProperty("run_fraction");
      // but no extras → no extras_run
      expect(overall).not.toHaveProperty("extras_run");
    } finally {
      if (prev !== undefined) process.env.EXTRA_STREAM_FIELDS = prev;
      vi.resetModules();
    }
  });
});
