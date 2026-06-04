// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  buildValidMask,
  calcMovingTime,
  velocityToPace,
  splitByMovingTime,
  splitByDistance,
  splitByBreakpoints,
  avgInRange,
  calcDecoupling,
  calcZoneTimes,
} from "../src/utils/stream-processing.js";

// ─── buildValidMask ───────────────────────────────────────────────────────────

describe("buildValidMask", () => {
  it("全データ有効（停止なし、warmup=0）→ 全 true", () => {
    const time = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const velocity = [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];
    const { validMask, stopSegments, timeGaps } = buildValidMask(time, velocity, {
      warmupExcludeSec: 0,
      postStopBufferSec: 30,
    });
    expect(validMask.every((v) => v === true)).toBe(true);
    expect(stopSegments).toBe(0);
    expect(timeGaps).toBe(0);
  });

  it("velocity < 0.5 が連続 15 秒 → その区間 + バッファ 30 秒が false", () => {
    // time: 0..59 (60 points, 1 sec interval)
    // stop: indices 10..25 → duration = time[25] - time[10] = 15 sec ≥ 10 → valid stop
    // buffer: bufferEndTime = 25 + 30 = 55 → indices 26..55 are false (time ≤ 55)
    // before stop (0..9) and after buffer (56..59) → true
    const time = Array.from({ length: 60 }, (_, i) => i);
    const velocity = time.map((t) => (t >= 10 && t <= 25 ? 0.0 : 1.5));

    const { validMask, stopSegments, stoppedTimeSec } = buildValidMask(time, velocity, {
      warmupExcludeSec: 0,
      postStopBufferSec: 30,
    });

    expect(validMask[9]).toBe(true);   // 停止前
    expect(validMask[10]).toBe(false); // 停止区間の先頭
    expect(validMask[25]).toBe(false); // 停止区間の末尾
    expect(validMask[26]).toBe(false); // バッファ先頭
    expect(validMask[55]).toBe(false); // バッファ末尾 (time=55 ≤ 55)
    expect(validMask[56]).toBe(true);  // バッファ後 (time=56 > 55)
    expect(validMask[59]).toBe(true);  // 最後

    expect(stopSegments).toBe(1);
    expect(stoppedTimeSec).toBe(15); // time[25] - time[10]
  });

  it("time にギャップあり（PAUSE）→ timeGaps がカウントされる", () => {
    // gap at index 3→4: 100 - 3 = 97 > 5 → 1 gap
    const time = [0, 1, 2, 3, 100, 101, 102];
    const velocity = [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];

    const { validMask, timeGaps } = buildValidMask(time, velocity, {
      warmupExcludeSec: 0,
      postStopBufferSec: 30,
    });

    expect(timeGaps).toBe(1);
    expect(validMask.every((v) => v === true)).toBe(true);
  });

  it("warmup 600 秒除外 → time < 600 のインデックスが false", () => {
    const time = [0, 100, 200, 500, 600, 700];
    const velocity = [1.5, 1.5, 1.5, 1.5, 1.5, 1.5];

    const { validMask } = buildValidMask(time, velocity, {
      warmupExcludeSec: 600,
      postStopBufferSec: 30,
    });

    // time < 600 → false
    expect(validMask[0]).toBe(false); // time=0
    expect(validMask[1]).toBe(false); // time=100
    expect(validMask[2]).toBe(false); // time=200
    expect(validMask[3]).toBe(false); // time=500
    // time >= 600 → true
    expect(validMask[4]).toBe(true);  // time=600
    expect(validMask[5]).toBe(true);  // time=700
  });

  it("短い停止（duration < 10秒）→ 停止とみなさない（全 true）", () => {
    // indices 2,3,4 で velocity=0: time[2]=2, time[4]=4 → duration=2 < 10 → 無視
    const time = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const velocity = [1.5, 1.5, 0.0, 0.0, 0.0, 1.5, 1.5, 1.5, 1.5, 1.5];

    const { validMask, stopSegments } = buildValidMask(time, velocity, {
      warmupExcludeSec: 0,
      postStopBufferSec: 30,
    });

    expect(validMask.every((v) => v === true)).toBe(true);
    expect(stopSegments).toBe(0);
  });
});

// ─── calcMovingTime ───────────────────────────────────────────────────────────

describe("calcMovingTime", () => {
  it("連続 100 秒データ（ギャップなし）→ 100", () => {
    const time = Array.from({ length: 101 }, (_, i) => i); // 0..100
    const validMask = new Array<boolean>(101).fill(true);
    expect(calcMovingTime(time, validMask)).toBe(100);
  });

  it("time にギャップあり → ギャップ部分は加算されない", () => {
    // [0,1,2,50,51,52]: 有効ペアの gap → 1,1,(48→skip),1,1 → total=4
    const time = [0, 1, 2, 50, 51, 52];
    const validMask = new Array<boolean>(6).fill(true);
    expect(calcMovingTime(time, validMask)).toBe(4);
  });

  it("validMask で一部除外 → 有効隣接ペアのみ合計", () => {
    const time = [0, 1, 2, 3, 4];
    const validMask = [true, false, false, true, true];
    // 有効な隣接ペアは (3,4) のみ → gap=1
    expect(calcMovingTime(time, validMask)).toBe(1);
  });
});

// ─── totalMovingSec 計算パターン（buildValidMask(warmup=0) + calcMovingTime）──

describe("totalMovingSec pattern: buildValidMask(warmup=0) + calcMovingTime", () => {
  it("PAUSE ギャップ（90秒）を含むデータ → totalMovingSec < totalElapsedSec", () => {
    // 前半: 0..29 (30 points, 1s interval), PAUSE 90s, 後半: 120..149 (30 points)
    // totalElapsedSec = 149 - 0 = 149
    // 実際の moving time = 29 + 29 = 58（PAUSE の 90 秒はギャップで加算されない）
    const time = [
      ...Array.from({ length: 30 }, (_, i) => i),       // 0..29
      ...Array.from({ length: 30 }, (_, i) => 120 + i),  // 120..149
    ];
    const velocity: (number | null)[] = new Array(60).fill(3.0);

    const { validMask: stopOnlyMask } = buildValidMask(time, velocity, {
      warmupExcludeSec: 0,
      postStopBufferSec: 30,
    });
    const totalMovingSec = calcMovingTime(time, stopOnlyMask);
    const totalElapsedSec = time[time.length - 1] - time[0];

    expect(totalElapsedSec).toBe(149);
    expect(totalMovingSec).toBe(58);
    expect(totalMovingSec).toBeLessThan(totalElapsedSec);
  });

  it("PAUSE なし・停止なし → totalMovingSec ≈ totalElapsedSec", () => {
    // 連続 1 秒間隔 300 ポイント、停止なし
    const time = Array.from({ length: 300 }, (_, i) => i);
    const velocity: (number | null)[] = new Array(300).fill(3.0);

    const { validMask: stopOnlyMask } = buildValidMask(time, velocity, {
      warmupExcludeSec: 0,
      postStopBufferSec: 30,
    });
    const totalMovingSec = calcMovingTime(time, stopOnlyMask);
    const totalElapsedSec = time[time.length - 1] - time[0];

    expect(totalElapsedSec).toBe(299);
    expect(totalMovingSec).toBe(299);
  });

  it("複数 PAUSE ギャップ → 各ギャップが除外される", () => {
    // 3区間: 0..19, PAUSE 60s, 80..99, PAUSE 120s, 220..239
    const time = [
      ...Array.from({ length: 20 }, (_, i) => i),        // 0..19
      ...Array.from({ length: 20 }, (_, i) => 80 + i),   // 80..99
      ...Array.from({ length: 20 }, (_, i) => 220 + i),  // 220..239
    ];
    const velocity: (number | null)[] = new Array(60).fill(3.0);

    const { validMask: stopOnlyMask } = buildValidMask(time, velocity, {
      warmupExcludeSec: 0,
      postStopBufferSec: 30,
    });
    const totalMovingSec = calcMovingTime(time, stopOnlyMask);
    const totalElapsedSec = time[time.length - 1] - time[0];

    expect(totalElapsedSec).toBe(239);
    // 19 + 19 + 19 = 57（各区間内の moving time）
    expect(totalMovingSec).toBe(57);
  });
});

// ─── splitByMovingTime ────────────────────────────────────────────────────────

describe("splitByMovingTime", () => {
  it("120 秒のデータを halves → 2 区間、各約 60 秒", () => {
    // time 0..120 (121 points), totalMovingTime=120, targetPerSplit=60
    // split 境界: cumMovingTime=60 となる j=60 → split1={0,60}, split2={61,120}
    const time = Array.from({ length: 121 }, (_, i) => i);
    const validMask = new Array<boolean>(121).fill(true);

    const splits = splitByMovingTime(time, validMask, 2);

    expect(splits).toHaveLength(2);
    expect(splits[0].startIdx).toBe(0);
    expect(splits[0].endIdx).toBe(60);
    expect(splits[1].startIdx).toBe(61);
    expect(splits[1].endIdx).toBe(120);
  });

  it("300 秒のデータを thirds → 3 区間、各約 100 秒", () => {
    // time 0..300 (301 points), totalMovingTime=300, targetPerSplit=100
    const time = Array.from({ length: 301 }, (_, i) => i);
    const validMask = new Array<boolean>(301).fill(true);

    const splits = splitByMovingTime(time, validMask, 3);

    expect(splits).toHaveLength(3);
    expect(splits[0].startIdx).toBe(0);
    expect(splits[0].endIdx).toBe(100);
    expect(splits[1].startIdx).toBe(101);
    expect(splits[1].endIdx).toBe(200);
    expect(splits[2].startIdx).toBe(201);
    expect(splits[2].endIdx).toBe(300);
  });

  it("ギャップありデータの分割は moving time ベースで PAUSE をまたがない", () => {
    // time: 0..29 (30 points), gap 71 sec, then 100..129 (30 points)
    // totalMovingTime = 29 + 29 = 58, targetPerSplit = 29
    // split 境界: cumMovingTime=29 となる j=29 → split1={0,29}, split2={30,59}
    // split2.startIdx=30 は time[30]=100（PAUSE 後の最初の点）
    const time = Array.from({ length: 60 }, (_, i) => (i < 30 ? i : i + 70));
    const validMask = new Array<boolean>(60).fill(true);

    const splits = splitByMovingTime(time, validMask, 2);

    expect(splits).toHaveLength(2);
    expect(splits[0].startIdx).toBe(0);
    expect(splits[0].endIdx).toBe(29);
    // split2 は PAUSE 後のポイント（time=100）から始まる
    expect(time[splits[1].startIdx]).toBe(100);
    expect(splits[1].endIdx).toBe(59);
  });
});

// ─── splitByDistance ──────────────────────────────────────────────────────────

describe("splitByDistance", () => {
  it("10km を 1000m 分割 → 10 セグメント", () => {
    // distance: 0, 100, 200, ..., 10000 (101 points)
    // 1000m 境界: 1000, 2000, ..., 10000 (各境界点が split の endIdx)
    const distance: (number | null)[] = Array.from({ length: 101 }, (_, i) => i * 100);
    const validMask = new Array<boolean>(101).fill(true);

    const splits = splitByDistance(distance, validMask, 1000);

    expect(splits).toHaveLength(10);
    // 各 split の endIdx に距離 1000m の倍数が含まれる
    expect(distance[splits[0].endIdx]).toBe(1000);
    expect(distance[splits[9].endIdx]).toBe(10000);
  });

  it("端数処理: 10500m → 10 セグメント + 500m の最後のセグメント", () => {
    // distance: 0, 100, ..., 10500 (106 points)
    const distance: (number | null)[] = Array.from({ length: 106 }, (_, i) => i * 100);
    const validMask = new Array<boolean>(106).fill(true);

    const splits = splitByDistance(distance, validMask, 1000);

    expect(splits).toHaveLength(11);
    // 最後のセグメントは端数（10100m〜10500m）
    expect(distance[splits[10].startIdx]).toBe(10100);
    expect(distance[splits[10].endIdx]).toBe(10500);
  });
});

// ─── splitByBreakpoints ────────────────────────────────────────────────────────

describe("splitByBreakpoints", () => {
  it("3つのブレイクポイントで4区間に分割", () => {
    // distance: 0, 100, ..., 10000 (101 points)
    // breakpoints: [3000, 6000, 8000] → [0-3km, 3-6km, 6-8km, 8-10km]
    const distance: (number | null)[] = Array.from({ length: 101 }, (_, i) => i * 100);
    const validMask = new Array<boolean>(101).fill(true);
    const splits = splitByBreakpoints(distance, validMask, [3000, 6000, 8000]);
    expect(splits).toHaveLength(4);
    expect(distance[splits[0].endIdx]).toBe(3000);
    expect(distance[splits[1].startIdx]).toBe(3100);
    expect(distance[splits[1].endIdx]).toBe(6000);
  });

  it("ブレイクポイントがデータ範囲を超える場合、最終区間は実データ末尾まで", () => {
    // distance: 0, 100, ..., 5000 (51 points), breakpoints: [3000, 8000]
    // 8000m には到達しないので2区間
    const distance: (number | null)[] = Array.from({ length: 51 }, (_, i) => i * 100);
    const validMask = new Array<boolean>(51).fill(true);
    const splits = splitByBreakpoints(distance, validMask, [3000, 8000]);
    expect(splits).toHaveLength(2);
    expect(distance[splits[0].endIdx]).toBe(3000);
    expect(distance[splits[1].endIdx]).toBe(5000);
  });

  it("空のブレイクポイント配列 → 全体が1区間", () => {
    const distance: (number | null)[] = Array.from({ length: 101 }, (_, i) => i * 100);
    const validMask = new Array<boolean>(101).fill(true);
    const splits = splitByBreakpoints(distance, validMask, []);
    expect(splits).toHaveLength(1);
    expect(distance[splits[0].startIdx]).toBe(0);
    expect(distance[splits[0].endIdx]).toBe(10000);
  });

  it("ブレイクポイントが1つ → 2区間", () => {
    // distance: 0, 100, ..., 10000 (101 points), breakpoint: [5000]
    const distance: (number | null)[] = Array.from({ length: 101 }, (_, i) => i * 100);
    const validMask = new Array<boolean>(101).fill(true);
    const splits = splitByBreakpoints(distance, validMask, [5000]);
    expect(splits).toHaveLength(2);
    expect(distance[splits[0].endIdx]).toBe(5000);
    expect(distance[splits[1].startIdx]).toBe(5100);
    expect(distance[splits[1].endIdx]).toBe(10000);
  });

  it("順不同のブレイクポイントは昇順ソートされる", () => {
    const distance: (number | null)[] = Array.from({ length: 101 }, (_, i) => i * 100);
    const validMask = new Array<boolean>(101).fill(true);
    // Same as 3-split test but breakpoints given out of order
    const splits = splitByBreakpoints(distance, validMask, [6000, 3000]);
    expect(splits).toHaveLength(3);
    expect(distance[splits[0].endIdx]).toBe(3000);
    expect(distance[splits[1].endIdx]).toBe(6000);
  });
});

// ─── avgInRange ───────────────────────────────────────────────────────────────

describe("avgInRange", () => {
  it("[10, 20, 30] で全有効 → 20", () => {
    const data: (number | null)[] = [10, 20, 30];
    const mask = [true, true, true];
    expect(avgInRange(data, mask, 0, 2)).toBe(20);
  });

  it("[10, null, 30] → null をスキップして 20", () => {
    const data: (number | null)[] = [10, null, 30];
    const mask = [true, true, true];
    expect(avgInRange(data, mask, 0, 2)).toBe(20);
  });

  it("全 null → null", () => {
    const data: (number | null)[] = [null, null, null];
    const mask = [true, true, true];
    expect(avgInRange(data, mask, 0, 2)).toBeNull();
  });

  it("空配列に対して範囲参照 → null（NaN でない）", () => {
    const result = avgInRange([], [true, true], 0, 1);
    expect(result).toBeNull();
  });

  it("data が短く end が範囲外 → undefined を無視して null", () => {
    const data: (number | null)[] = [10];
    const mask = [true, true, true];
    const result = avgInRange(data, mask, 0, 2);
    // data[1], data[2] は undefined → typeof !== "number" でスキップ
    // data[0] = 10 のみ有効
    expect(result).toBe(10);
  });
});

// ─── calcDecoupling ───────────────────────────────────────────────────────────

describe("calcDecoupling", () => {
  // 120 points (time 0..119), splits: [0..60] and [61..119]
  // totalMovingTime=119, targetPerSplit=59.5 → split at j=60 (cumMT=60 ≥ 59.5)

  it("一定 HR=150, velocity=3.0 → decoupling ≈ 0%", () => {
    const n = 120;
    const time = Array.from({ length: n }, (_, i) => i);
    const hr = new Array<number | null>(n).fill(150);
    const velocity = new Array<number | null>(n).fill(3.0);
    const validMask = new Array<boolean>(n).fill(true);

    const dc = calcDecoupling(time, hr, velocity, validMask);
    expect(dc).not.toBeNull();
    expect(dc!).toBeCloseTo(0, 5);
  });

  it("後半 HR が上昇（H1=140, H2=160）、velocity 一定 → 正の decoupling", () => {
    const n = 120;
    const time = Array.from({ length: n }, (_, i) => i);
    // split1: 0..60 (HR=140), split2: 61..119 (HR=160)
    const hr: (number | null)[] = Array.from({ length: n }, (_, i) => (i <= 60 ? 140 : 160));
    const velocity = new Array<number | null>(n).fill(3.0);
    const validMask = new Array<boolean>(n).fill(true);

    const dc = calcDecoupling(time, hr, velocity, validMask);
    // H1_ef = 3.0/140 > H2_ef = 3.0/160 → decoupling > 0
    expect(dc).not.toBeNull();
    expect(dc!).toBeGreaterThan(0);
  });

  it("後半 velocity が低下（H1=3.0, H2=2.5）、HR 一定 → 正の decoupling", () => {
    const n = 120;
    const time = Array.from({ length: n }, (_, i) => i);
    const hr = new Array<number | null>(n).fill(150);
    // split1: 0..60 (vel=3.0), split2: 61..119 (vel=2.5)
    const velocity: (number | null)[] = Array.from({ length: n }, (_, i) =>
      i <= 60 ? 3.0 : 2.5
    );
    const validMask = new Array<boolean>(n).fill(true);

    const dc = calcDecoupling(time, hr, velocity, validMask);
    // H1_ef = 3.0/150 > H2_ef = 2.5/150 → decoupling > 0
    expect(dc).not.toBeNull();
    expect(dc!).toBeGreaterThan(0);
  });
});

// ─── velocityToPace ──────────────────────────────────────────────────────────

describe("velocityToPace", () => {
  it("2.78 m/s → 約 360 秒/km (6:00/km)", () => {
    expect(velocityToPace(2.78)).toBeCloseTo(1000 / 2.78, 1);
  });

  it("0 m/s → Infinity", () => {
    expect(velocityToPace(0)).toBe(Infinity);
  });

  it("負の velocity → Infinity", () => {
    expect(velocityToPace(-1)).toBe(Infinity);
  });
});

// ─── calcZoneTimes ────────────────────────────────────────────────────────────

describe("calcZoneTimes", () => {
  it("全データが1つのゾーンに収まる場合", () => {
    // boundaries=[100, 200], values all 150 → zone 1 に全秒数
    const time = [0, 1, 2, 3, 4, 5];
    const values: (number | null)[] = [150, 150, 150, 150, 150, 150];
    const validMask = [true, true, true, true, true, true];
    const { zones, totalClassifiedSecs } = calcZoneTimes(time, values, validMask, [100, 200]);
    expect(zones).toEqual([0, 5, 0]); // 5 intervals (0→1, 1→2, ..., 4→5)
    expect(totalClassifiedSecs).toBe(5);
  });

  it("複数ゾーンに分散する場合", () => {
    // boundaries=[100, 200]
    // zone 0: <100,  zone 1: 100-199,  zone 2: >=200
    const time = [0, 1, 2, 3, 4, 5];
    const values: (number | null)[] = [50, 50, 150, 150, 250, 250];
    const validMask = [true, true, true, true, true, true];
    const { zones, totalClassifiedSecs } = calcZoneTimes(time, values, validMask, [100, 200]);
    // i=0(v=50,dt=1)→zone0, i=1(v=50,dt=1)→zone0, i=2(v=150,dt=1)→zone1,
    // i=3(v=150,dt=1)→zone1, i=4(v=250,dt=1)→zone2
    // (i=5 is last point, no dt)
    expect(zones).toEqual([2, 2, 1]);
    expect(totalClassifiedSecs).toBe(5);
  });

  it("境界値ちょうどは上のゾーンに入る", () => {
    // boundaries=[100], value=100 → zone 1 (>=100)
    const time = [0, 1, 2];
    const values: (number | null)[] = [100, 100, 100];
    const validMask = [true, true, true];
    const { zones } = calcZoneTimes(time, values, validMask, [100]);
    expect(zones).toEqual([0, 2]); // zone 0: <100 → 0sec, zone 1: >=100 → 2sec
  });

  it("null 値のポイントはスキップされる", () => {
    const time = [0, 1, 2, 3, 4];
    const values: (number | null)[] = [150, null, 150, null, 150];
    const validMask = [true, true, true, true, true];
    const { zones, totalClassifiedSecs } = calcZoneTimes(time, values, validMask, [100, 200]);
    // i=0(v=150,dt=1)→zone1, i=1(v=null,skip), i=2(v=150,dt=1)→zone1, i=3(v=null,skip)
    expect(zones).toEqual([0, 2, 0]);
    expect(totalClassifiedSecs).toBe(2);
  });

  it("validMask=false のポイントはスキップされる", () => {
    const time = [0, 1, 2, 3, 4];
    const values: (number | null)[] = [150, 150, 150, 150, 150];
    const validMask = [true, true, false, false, true];
    const { zones, totalClassifiedSecs } = calcZoneTimes(time, values, validMask, [100, 200]);
    // i=0(ok,dt=1)→zone1, i=1(mask[2]=false,skip), i=2(mask=false,skip), i=3(mask[3]=false,skip)
    expect(zones).toEqual([0, 1, 0]);
    expect(totalClassifiedSecs).toBe(1);
  });

  it("PAUSE ギャップ（>5秒）を含むデータでギャップがスキップされる", () => {
    // time: 0,1,2, GAP, 100,101,102 — gap=98秒 at index 2→3
    const time = [0, 1, 2, 100, 101, 102];
    const values: (number | null)[] = [150, 150, 150, 150, 150, 150];
    const validMask = [true, true, true, true, true, true];
    const { zones, totalClassifiedSecs } = calcZoneTimes(time, values, validMask, [100, 200]);
    // i=0(dt=1,ok), i=1(dt=1,ok), i=2(dt=98,SKIP), i=3(dt=1,ok), i=4(dt=1,ok)
    expect(zones).toEqual([0, 4, 0]);
    expect(totalClassifiedSecs).toBe(4);
  });

  it("空の boundaries → 全データが zone 0 に入る", () => {
    const time = [0, 1, 2, 3];
    const values: (number | null)[] = [150, 150, 150, 150];
    const validMask = [true, true, true, true];
    const { zones, totalClassifiedSecs } = calcZoneTimes(time, values, validMask, []);
    expect(zones).toEqual([3]); // 1 zone (everything), 3 intervals
    expect(totalClassifiedSecs).toBe(3);
  });

  it("全ポイントが null → totalClassifiedSecs = 0", () => {
    const time = [0, 1, 2, 3];
    const values: (number | null)[] = [null, null, null, null];
    const validMask = [true, true, true, true];
    const { zones, totalClassifiedSecs } = calcZoneTimes(time, values, validMask, [100]);
    expect(zones).toEqual([0, 0]);
    expect(totalClassifiedSecs).toBe(0);
  });
});
