// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ActivityStreamRaw } from "../core/types.js";

/** velocity < 0.5 m/s を停止とみなす閾値 */
const STOP_VELOCITY_THRESHOLD = 0.5;
/** 停止区間の最低継続時間（time 値ベース、秒）。これ未満の停止は無視する */
const MIN_STOP_DURATION_SEC = 10;
/** PAUSE 判定のための time ギャップ閾値（秒）。超えた場合は加算しない */
const TIME_GAP_THRESHOLD_SEC = 5;

/**
 * ストリーム配列 → type→data マップ変換
 */
export function streamsToMap(
  streams: ActivityStreamRaw[]
): Map<string, (number | null)[]> {
  const map = new Map<string, (number | null)[]>();
  for (const s of streams) {
    map.set(s.type, s.data);
  }
  return map;
}

/**
 * 停止区間検出 + 有効データマスク生成
 *
 * STREAMS_DESIGN.md Stage 2 に従う:
 *   2a. time 配列のギャップ検出（PAUSE）
 *   2b. velocity < 0.5 m/s の連続区間を停止とみなす（最低 10 秒）
 *   2c. 停止終了後に postStopBufferSec 分のデータを無効化
 *   2d. 最初の warmupExcludeSec 秒を無効化
 *
 * 停止の「秒数」は time 配列の値ベース（time[end] - time[start]）で判定する。
 * 10 秒未満の停止は無視する。
 */
export function buildValidMask(
  time: number[],
  velocity: (number | null)[],
  options: { warmupExcludeSec: number; postStopBufferSec: number }
): {
  validMask: boolean[];
  timeGaps: number;
  stopSegments: number;
  stoppedTimeSec: number;
  bufferTimeSec: number;
} {
  const n = time.length;
  const validMask = new Array<boolean>(n).fill(true);

  // Step 2a: time ギャップ（PAUSE）の数をカウント
  let timeGaps = 0;
  for (let i = 0; i < n - 1; i++) {
    if (time[i + 1] - time[i] > TIME_GAP_THRESHOLD_SEC) {
      timeGaps++;
    }
  }

  // Step 2b + 2c: 停止区間検出とバッファ適用
  let stopSegments = 0;
  let stoppedTimeSec = 0;
  let bufferTimeSec = 0;

  let i = 0;
  while (i < n) {
    const v = velocity[i];
    if (v === null || v < STOP_VELOCITY_THRESHOLD) {
      // 停止区間の開始インデックスを記録
      const startIdx = i;
      // 停止が続く間スキャン
      while (i < n) {
        const vi = velocity[i];
        if (vi !== null && vi >= STOP_VELOCITY_THRESHOLD) break;
        i++;
      }
      const endIdx = i - 1; // 停止区間の最後のインデックス（inclusive）

      // time 値ベースで継続時間を判定
      const duration = time[endIdx] - time[startIdx];
      if (duration >= MIN_STOP_DURATION_SEC) {
        stopSegments++;
        stoppedTimeSec += duration;

        // 停止区間を無効化
        for (let j = startIdx; j <= endIdx; j++) {
          validMask[j] = false;
        }

        // Step 2c: 停止終了後の復帰バッファを無効化
        const bufferEndTime = time[endIdx] + options.postStopBufferSec;
        for (let j = endIdx + 1; j < n && time[j] <= bufferEndTime; j++) {
          if (validMask[j]) {
            const dt = time[j] - time[j - 1];
            bufferTimeSec += dt <= TIME_GAP_THRESHOLD_SEC ? dt : 0;
            validMask[j] = false;
          }
        }
      }
    } else {
      i++;
    }
  }

  // Step 2d: ウォームアップ除外（time[i] < time[0] + warmupExcludeSec の点を無効化）
  if (options.warmupExcludeSec > 0 && n > 0) {
    const warmupEndTime = time[0] + options.warmupExcludeSec;
    for (let wi = 0; wi < n && time[wi] < warmupEndTime; wi++) {
      validMask[wi] = false;
    }
  }

  return { validMask, timeGaps, stopSegments, stoppedTimeSec, bufferTimeSec };
}

/**
 * 有効データの moving time 合計（秒）
 *
 * 隣接する valid ポイント間の時間差を合計する。
 * time[i+1] - time[i] > 5 のギャップ（PAUSE）は加算しない。
 */
export function calcMovingTime(time: number[], validMask: boolean[]): number {
  let total = 0;
  for (let i = 0; i < time.length - 1; i++) {
    if (validMask[i] && validMask[i + 1]) {
      const gap = time[i + 1] - time[i];
      if (gap <= TIME_GAP_THRESHOLD_SEC) {
        total += gap;
      }
    }
  }
  return total;
}

/**
 * 速度 (m/s) → ペース (秒/km) 変換
 *
 * @returns velocity <= 0 の場合は Infinity
 */
export function velocityToPace(velocityMs: number): number {
  if (velocityMs <= 0) return Infinity;
  return 1000 / velocityMs;
}

/**
 * 有効データの moving time を numSplits 等分する
 *
 * 分割境界のポイントは現在の split の endIdx として扱い、
 * 次の split は直後の有効ポイント (splitStartValidIdx = j + 1) から開始する。
 * time ギャップ (> 5 秒) は calcMovingTime と同じルールで扱う。
 *
 * @returns startIdx/endIdx は元配列のインデックス（inclusive）
 */
export function splitByMovingTime(
  time: number[],
  validMask: boolean[],
  numSplits: number
): Array<{ startIdx: number; endIdx: number }> {
  const validIndices: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (validMask[i]) validIndices.push(i);
  }
  if (validIndices.length === 0) return [];

  const totalMovingTime = calcMovingTime(time, validMask);
  if (numSplits <= 1 || totalMovingTime === 0) {
    return [{ startIdx: validIndices[0], endIdx: validIndices[validIndices.length - 1] }];
  }

  const targetPerSplit = totalMovingTime / numSplits;
  const splits: Array<{ startIdx: number; endIdx: number }> = [];
  let splitStartValidIdx = 0;
  let cumMovingTime = 0;

  for (let j = 1; j < validIndices.length; j++) {
    const prevIdx = validIndices[j - 1];
    const currIdx = validIndices[j];
    const gap = time[currIdx] - time[prevIdx];
    if (gap <= TIME_GAP_THRESHOLD_SEC) {
      cumMovingTime += gap;
    }

    if (
      splits.length < numSplits - 1 &&
      cumMovingTime >= targetPerSplit * (splits.length + 1)
    ) {
      splits.push({ startIdx: validIndices[splitStartValidIdx], endIdx: currIdx });
      splitStartValidIdx = j + 1;
    }
  }

  // 残余ポイントを最後の split として追加
  if (splitStartValidIdx < validIndices.length) {
    splits.push({
      startIdx: validIndices[splitStartValidIdx],
      endIdx: validIndices[validIndices.length - 1],
    });
  }

  return splits;
}

/**
 * 累積 distance を intervalMeters ごとに分割する
 *
 * 各 km 境界に達した時点のポイントを現在 split の endIdx として扱い、
 * 次の split は直後のポイントから開始する。端数は最後の split に含める。
 *
 * @returns startIdx/endIdx は元配列のインデックス（inclusive）
 */
export function splitByDistance(
  distance: (number | null)[],
  validMask: boolean[],
  intervalMeters = 1000
): Array<{ startIdx: number; endIdx: number }> {
  const validIndices: number[] = [];
  for (let i = 0; i < distance.length; i++) {
    if (validMask[i] && distance[i] !== null) validIndices.push(i);
  }
  if (validIndices.length === 0) return [];

  const startDist = distance[validIndices[0]] as number;
  // startDist を超える最初の intervalMeters の倍数を閾値にする
  let nextThreshold = Math.floor(startDist / intervalMeters + 1) * intervalMeters;

  const splits: Array<{ startIdx: number; endIdx: number }> = [];
  let splitStartValidIdx = 0;

  for (let j = 0; j < validIndices.length; j++) {
    const dist = distance[validIndices[j]] as number;
    if (dist >= nextThreshold) {
      splits.push({ startIdx: validIndices[splitStartValidIdx], endIdx: validIndices[j] });
      splitStartValidIdx = j + 1;
      while (nextThreshold <= dist) {
        nextThreshold += intervalMeters;
      }
    }
  }

  // 端数（最後の不完全な split）を追加
  if (splitStartValidIdx < validIndices.length) {
    splits.push({
      startIdx: validIndices[splitStartValidIdx],
      endIdx: validIndices[validIndices.length - 1],
    });
  }

  return splits;
}

/**
 * data[startIdx..endIdx] のうち validMask=true かつ非 null の平均を返す。
 * 有効データが 1 件もなければ null を返す。
 */
export function avgInRange(
  data: (number | null)[],
  mask: boolean[],
  start: number,
  end: number
): number | null {
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i++) {
    const v = data[i];
    if (mask[i] && typeof v === "number") {
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/**
 * data[startIdx..endIdx] のうち validMask=true かつ非 null の値から
 * パーセンタイル p（0–100）を nearest-rank 法で返す。
 * 有効データが 1 件もなければ null。
 *
 * nearest-rank: 昇順ソート後、rank = ceil(p/100 × N)（1-based、[1,N] にクランプ）、
 * 値 = sorted[rank-1]。p=100 で最大値、p→0 で最小値（rank<1 を 1 にクランプ）。
 * avgInRange と同様、丸めは呼び出し側の責務（生値を返す）。
 */
export function percentileInRange(
  data: (number | null)[],
  mask: boolean[],
  start: number,
  end: number,
  p: number
): number | null {
  const values: number[] = [];
  for (let i = start; i <= end; i++) {
    const v = data[i];
    if (mask[i] && typeof v === "number") values.push(v);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * values.length);
  const idx = Math.min(Math.max(rank, 1), values.length) - 1;
  return values[idx];
}

/**
 * カスタム距離ブレイクポイントで分割する。
 * breakpoints は昇順のメートル値配列。
 * 例: [6000, 12200, 31300] → 4区間: [0-6km, 6-12.2km, 12.2-31.3km, 31.3km-end]
 *
 * splitByDistance と異なり、不等間隔の分割をサポート。
 *
 * @returns startIdx/endIdx は元配列のインデックス（inclusive）
 */
export function splitByBreakpoints(
  distance: (number | null)[],
  validMask: boolean[],
  breakpoints: number[]
): Array<{ startIdx: number; endIdx: number }> {
  const validIndices: number[] = [];
  for (let i = 0; i < distance.length; i++) {
    if (validMask[i] && distance[i] !== null) validIndices.push(i);
  }
  if (validIndices.length === 0) return [];

  if (breakpoints.length === 0) {
    return [{ startIdx: validIndices[0], endIdx: validIndices[validIndices.length - 1] }];
  }

  const sorted = [...breakpoints].sort((a, b) => a - b);
  const splits: Array<{ startIdx: number; endIdx: number }> = [];
  let splitStartValidIdx = 0;
  let bpIdx = 0;

  for (let j = 0; j < validIndices.length; j++) {
    const dist = distance[validIndices[j]] as number;
    if (bpIdx < sorted.length && dist >= sorted[bpIdx]) {
      splits.push({ startIdx: validIndices[splitStartValidIdx], endIdx: validIndices[j] });
      splitStartValidIdx = j + 1;
      bpIdx++;
      // 同一距離点で複数ブレイクポイントを超える場合はスキップ
      while (bpIdx < sorted.length && dist >= sorted[bpIdx]) {
        bpIdx++;
      }
    }
  }

  // 最後のブレイクポイント以降のデータを最終 split に追加
  if (splitStartValidIdx < validIndices.length) {
    splits.push({
      startIdx: validIndices[splitStartValidIdx],
      endIdx: validIndices[validIndices.length - 1],
    });
  }

  return splits;
}

/**
 * Cardiac Decoupling を計算する（前半/後半 halves 固定）
 *
 *   H1_ef = mean(metric_H1) / mean(hr_H1)
 *   H2_ef = mean(metric_H2) / mean(hr_H2)
 *   decoupling = (H1_ef - H2_ef) / H1_ef × 100
 *
 * hr または metric の有効データが不足している場合は null を返す。
 */
export function calcDecoupling(
  time: number[],
  hr: (number | null)[],
  metric: (number | null)[],
  validMask: boolean[]
): number | null {
  const halves = splitByMovingTime(time, validMask, 2);
  if (halves.length < 2) return null;

  const [h1, h2] = halves;
  const h1Hr = avgInRange(hr, validMask, h1.startIdx, h1.endIdx);
  const h2Hr = avgInRange(hr, validMask, h2.startIdx, h2.endIdx);
  const h1Metric = avgInRange(metric, validMask, h1.startIdx, h1.endIdx);
  const h2Metric = avgInRange(metric, validMask, h2.startIdx, h2.endIdx);

  if (h1Hr === null || h2Hr === null || h1Metric === null || h2Metric === null) return null;
  if (h1Hr === 0 || h1Metric === 0) return null;

  const h1Ef = h1Metric / h1Hr;
  const h2Ef = h2Metric / h2Hr;

  return ((h1Ef - h2Ef) / h1Ef) * 100;
}

/**
 * intervals.icu run cadence ストリームの単位係数。
 * spm = ストリーム値 × RUN_CADENCE_STREAM_TO_SPM。
 * 2026-06-11 実データ検証（activity i155897558、avg_cadence=86.6）: rpm → 2。
 * Intervals.icu の average_cadence（=87.1）と一致 → ストリームは rpm（片足）。
 */
export const RUN_CADENCE_STREAM_TO_SPM = 2;

/**
 * ストライド長 (m/step) = velocity / (spm / 60)。
 * Garmin の "stride length"（1歩あたり距離）と同義。
 * spm はヘルパ内で RUN_CADENCE_STREAM_TO_SPM を適用して得る。
 * avgVelocityMs / avgCadenceStream のどちらかが null または <= 0 なら null。
 */
export function strideLengthM(
  avgVelocityMs: number | null,
  avgCadenceStream: number | null,
): number | null {
  if (avgVelocityMs === null || avgCadenceStream === null) return null;
  if (avgVelocityMs <= 0 || avgCadenceStream <= 0) return null;
  const spm = avgCadenceStream * RUN_CADENCE_STREAM_TO_SPM;
  return avgVelocityMs / (spm / 60);
}

/** run 判定の cadence 閾値デフォルト（rpm・片足）。70 rpm = 140 spm。
 *  歩行 ≈50–60 rpm、ウルトラのシャッフル走 ≈72–78 rpm の間を分離する値。 */
export const DEFAULT_RUN_GATE_CADENCE_RPM = 70;

/**
 * 走行サンプルマスクを合成する。
 * runMask[i] = validMask[i] && cadence[i] is a number >= thresholdRpm
 * 定義より runMask ⊆ validMask。スムージング・ヒステリシスは行わない。
 */
export function buildRunMask(
  validMask: boolean[],
  cadence: (number | null)[],
  thresholdRpm: number,
): boolean[] {
  return validMask.map((valid, i) => {
    if (!valid) return false;
    const c = cadence[i];
    return typeof c === "number" && c >= thresholdRpm;
  });
}

/** mask[start..end] の true の個数（start, end ともに inclusive）。 */
export function countInRange(mask: boolean[], start: number, end: number): number {
  let count = 0;
  for (let i = start; i <= end; i++) {
    if (mask[i]) count++;
  }
  return count;
}

/**
 * カスタムゾーン境界によるゾーン滞在時間を計算する。
 *
 * boundaries が N 個の場合、N+1 個のゾーンを返す:
 *   zone 0: value < boundaries[0]
 *   zone 1: boundaries[0] <= value < boundaries[1]
 *   ...
 *   zone N: value >= boundaries[N-1]
 *
 * 各ポイントの時間寄与は time[i+1] - time[i] で計算する。
 * time ギャップ（> TIME_GAP_THRESHOLD_SEC）を超えるデルタはゼロ扱いにする。
 * これは calcMovingTime と同じ PAUSE ギャップ処理パターン。
 *
 * values[i] が null / undefined のポイントは分類不能としてスキップする。
 * validMask[i] === false のポイントもスキップする。
 *
 * @param time - 経過秒の配列（1秒刻み、PAUSE ギャップあり）
 * @param values - 分類対象の値（watts or heartrate）
 * @param validMask - buildValidMask で生成済みの有効データマスク
 * @param boundaries - ゾーン境界値の昇順配列（例: [143, 174, 187, 200, 220]）
 * @returns zones 配列（length = boundaries.length + 1）と total_classified_secs
 */
export function calcZoneTimes(
  time: number[],
  values: (number | null)[],
  validMask: boolean[],
  boundaries: number[]
): { zones: number[]; totalClassifiedSecs: number } {
  const zones = new Array(boundaries.length + 1).fill(0);
  let totalClassifiedSecs = 0;

  for (let i = 0; i < time.length - 1; i++) {
    if (!validMask[i] || !validMask[i + 1]) continue;

    const dt = time[i + 1] - time[i];
    if (dt > TIME_GAP_THRESHOLD_SEC) continue;
    if (dt <= 0) continue;

    const v = values[i];
    if (typeof v !== "number") continue;

    let zoneIdx = boundaries.length;
    for (let j = 0; j < boundaries.length; j++) {
      if (v < boundaries[j]) {
        zoneIdx = j;
        break;
      }
    }

    zones[zoneIdx] += dt;
    totalClassifiedSecs += dt;
  }

  return { zones, totalClassifiedSecs };
}
