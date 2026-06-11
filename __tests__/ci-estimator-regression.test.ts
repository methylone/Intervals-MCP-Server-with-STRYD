// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Regression test for the CI reverse-estimator against the bundled pilot data.
 *
 * Replicates the pilot's evaluation (ci_reverse_fit.py): match Stryd CI labels to
 * Intervals flat-bin activities within ±2h, then at each activity estimate CI from
 * the trailing 90-day pool and compare to the label. The warmup-≥60d subset is
 * obtained for free by estimateCi's history gate (it returns null below 60 days).
 *
 * Fixtures are personal data — EXCLUDED from the public repo (PUBLIC_MANIFEST).
 * The whole suite skips when they are absent so public CI stays green.
 *
 * Band resolution (spec §2.1): the pilot doc cites [0.50, 1.05]·CP while
 * ci_reverse_fit.py defaults to [0.60, 1.10]. We evaluate both and assert the
 * adopted band reproduces the published r=0.93 / RMSE=1.9 / bias −1.3.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { estimateCi, type FlatBin } from "../src/extensions/stryd/ci-estimator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures", "ci-reverse");
const hasFixtures =
  existsSync(join(fixtureDir, "stryd_ci_labels.csv")) &&
  existsSync(join(fixtureDir, "intervals_flat_bins_1.txt")) &&
  existsSync(join(fixtureDir, "intervals_flat_bins_2.txt"));

type Label = { t: number; ci: number; cp: number };
type Act = { t: number; bins: FlatBin[]; ci?: number; cp?: number };

function parseLabels(): Label[] {
  const text = readFileSync(join(fixtureDir, "stryd_ci_labels.csv"), "utf-8");
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  const ix = (name: string) => header.indexOf(name);
  const out: Label[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const ci = Number(cols[ix("stryd_ci")]);
    if (!(ci > 0)) continue;
    out.push({ t: Number(cols[ix("start_time")]), ci, cp: Number(cols[ix("stryd_cp")]) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Parse "aid|YYYY-MM-DDTHH:MM:SS|type|key:n:sumI:sumW;..." lines (JST timestamps). */
function parseActivities(): Act[] {
  const acts: Act[] = [];
  for (const fn of ["intervals_flat_bins_1.txt", "intervals_flat_bins_2.txt"]) {
    const text = readFileSync(join(fixtureDir, fn), "utf-8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const [, t, , binStr] = line.split("|");
      // Local JST → unix seconds (pilot anchors bins datetime at +09:00).
      const tUnix = Math.floor(new Date(`${t}+09:00`).getTime() / 1000);
      const bins: FlatBin[] = [];
      for (const b of binStr.split(";")) {
        const [, nStr, sIStr, sWStr] = b.split(":");
        const n = Number(nStr);
        if (n < 5) continue;
        bins.push({ wattsMean: Number(sWStr) / n, ilrMean: Number(sIStr) / n, n });
      }
      acts.push({ t: tUnix, bins });
    }
  }
  acts.sort((a, b) => a.t - b.t);
  return acts;
}

function matchLabels(acts: Act[], labels: Label[]): Act[] {
  for (const a of acts) {
    let best: Label | null = null;
    let bd = Infinity;
    for (const l of labels) {
      const d = Math.abs(l.t - a.t);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    if (best && bd < 7200) {
      a.ci = best.ci;
      a.cp = best.cp;
    }
  }
  return acts.filter((a) => a.ci != null && a.cp != null);
}

const WINDOW_DAYS = 90;
const DAY = 86400;

function evaluateBand(matched: Act[], loFrac: number, hiFrac: number) {
  const pairs: Array<{ ci: number; est: number }> = [];
  for (let i = 0; i < matched.length; i++) {
    const t0 = matched[i].t;
    const cp = matched[i].cp!;
    const pool: FlatBin[][] = [];
    for (let j = 0; j <= i; j++) {
      const age = (t0 - matched[j].t) / DAY;
      if (age > WINDOW_DAYS) continue;
      pool.push(matched[j].bins);
    }
    const historyDays = (t0 - matched[0].t) / DAY;
    const { ciEstimate } = estimateCi(pool, cp, { loFrac, hiFrac, historyDays });
    if (ciEstimate != null) pairs.push({ ci: matched[i].ci!, est: ciEstimate });
  }
  const n = pairs.length;
  const errs = pairs.map((p) => p.est - p.ci);
  const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / n);
  const bias = errs.reduce((s, e) => s + e, 0) / n;
  const mc = pairs.reduce((s, p) => s + p.ci, 0) / n;
  const me = pairs.reduce((s, p) => s + p.est, 0) / n;
  let cov = 0;
  let vc = 0;
  let ve = 0;
  for (const p of pairs) {
    cov += (p.ci - mc) * (p.est - me);
    vc += (p.ci - mc) ** 2;
    ve += (p.est - me) ** 2;
  }
  const r = cov / Math.sqrt(vc * ve);
  return { n, r, rmse, bias };
}

type BandResult = { name: string; lo: number; hi: number; n: number; r: number; rmse: number; bias: number };

describe.skipIf(!hasFixtures)("CI estimator — pilot regression", () => {
  const bands = [
    { name: "[0.50, 1.05]", lo: 0.5, hi: 1.05 },
    { name: "[0.60, 1.10]", lo: 0.6, hi: 1.1 },
  ];
  // Fixture reads MUST be lazy: describe.skipIf still executes this callback at
  // collection time, so reading the (absent) CSV here would fail the whole suite
  // instead of skipping it. beforeAll runs only when the suite is NOT skipped.
  let matched: Act[];
  let results: BandResult[];

  beforeAll(() => {
    const labels = parseLabels();
    matched = matchLabels(parseActivities(), labels);
    results = bands.map((b) => ({ ...b, ...evaluateBand(matched, b.lo, b.hi) }));
  });

  it("matched a meaningful number of labelled activities", () => {
    expect(matched.length).toBeGreaterThan(80);
  });

  it("reports both candidate bands (band resolution §2.1)", () => {
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.error(
        `[ci-band] ${r.name}: n=${r.n} r=${r.r.toFixed(3)} RMSE=${r.rmse.toFixed(2)} bias=${r.bias.toFixed(2)}`,
      );
    }
    expect(results.length).toBe(2);
  });

  it("the adopted band [0.50, 1.05] reproduces the published metrics", () => {
    // Adopted constant lives in estimate-critical-impact.ts (CI_BAND_LO/HI).
    const adopted = results.find((r) => r.name === "[0.50, 1.05]")!;
    expect(adopted.r).toBeGreaterThanOrEqual(0.92);
    expect(adopted.rmse).toBeLessThanOrEqual(2.2);
    expect(Math.abs(adopted.bias)).toBeLessThanOrEqual(1.8);
  });
});
