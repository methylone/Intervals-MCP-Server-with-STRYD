# FR-NUTR-01: Wellness Nutrition Derived Fields

- **Status:** Implemented
- **Raised:** 2026-04-23
- **Revised:** 2026-04-23 (field name correction, r3)

> Note: This document is the technical contract for the five derived nutrition
> fields added to `get_wellness`. Personal training-program context from the
> original proposal has been removed for public release; the API contract,
> null-vs-0 semantics, day-boundary rules, and test vectors are unchanged.

---

## Summary

`get_wellness` のレスポンスに、食事摂取とワークアウト中 CHO から算出される派生フィールド 5 つを追加する。既存のソースデータ (wellness カスタムフィールド、activity データ) は一切変更しない、**読み取り時計算のみの拡張**。

---

## Field name note (r3)

Intervals.icu API 上の activity CHO grams フィールドは `carbohydrates` ではなく `carbs_ingested` が正。`cal_workout_intake` 定義式、Atwater Factor 例、Test Vector Pack の input 記述、Appendix の手順を `activity.carbs_ingested` に統一する。semantics・invariant・TV 期待値・scope は不変。

---

## Motivation

EA / LEA (Energy Availability / Low Energy Availability) 判定に使う `intake_kcal` は 2 ソース合算:

```
intake_kcal = Σ(CalBreakfast..CalSnack2)
            + Σ(当日 activities.carbs_ingested) × 4 kcal/g
```

MCP 派生フィールドが無い場合の問題点:

1. **API 呼び出しの分散:** クライアントが毎回 `get_wellness` と `get_activities` の 2 エンドポイントを呼んで合算する必要がある
2. **見落としリスク:** activity CHO を見ずに `get_wellness` だけで判定した場合、4h 超セッション日で 960-1,280 kcal 規模のずれが発生しうる (during 60-80g CHO/h × 4 kcal/g × 4h)
3. **記録完全性判定の重複実装:** 主食 3 食 (朝/昼/夕) が揃っているかの判定をクライアント側で毎回書くことになる
4. **null/0 の解釈ルールの分散:** 「未記録 (null)」と「食べなかった (0)」の区別が重要だが、これを各クライアントで一貫解釈させるには MCP 層で標準化するのが筋
5. **Day boundary の曖昧性:** 「当日の activity」の定義がクライアント側ごとにブレうる。特に timezone 混同や midnight crossing で結果が変わる

---

## Proposed API Changes

`GET /api/v1/athlete/{id}/wellness/{date}` のレスポンスに以下のフィールドを追加。

| フィールド | 型 | 意味 |
|---|---|---|
| `cal_diet_total` | number | 日常食事 5 フィールドの kcal 合計 |
| `cal_diet_main_meals_complete` | boolean | 朝 / 昼 / 夕 3 フィールドすべて non-null か |
| `cal_diet_recorded_count` | integer (0-5) | 食事 5 フィールドのうち non-null の数 |
| `cal_workout_intake` | number \| null | 当日 activities の CHO 合計 × 4 |
| `cal_intake_total` | number \| null | `cal_diet_total + cal_workout_intake` |

---

## Field Definitions

### cal_diet_total

```
cal_diet_total = sum of (CalBreakfast, CalLunch, CalDinner, CalSnack1, CalSnack2)
                 where null is treated as 0
```

- すべて null でも `0` を返す (not null)
- 常に number 型
- 単位: kcal (整数推奨、小数保持も許容)

### cal_diet_main_meals_complete

```
cal_diet_main_meals_complete =
    (CalBreakfast IS NOT NULL)
    AND (CalLunch IS NOT NULL)
    AND (CalDinner IS NOT NULL)
```

- snack の入力有無は影響しない
- `0` (明示入力) は non-null として扱う

### cal_diet_recorded_count

```
cal_diet_recorded_count = count of non-null fields
                          in [CalBreakfast, CalLunch, CalDinner, CalSnack1, CalSnack2]
```

- `0` (明示入力) は non-null としてカウントされる
- 範囲: 0-5

### cal_workout_intake

```
cal_workout_intake = sum of (activity.carbs_ingested) × 4
                     for all activities matching the given date
                     (see Day Boundary Semantics below for match rule)
```

- **当該日のすべての activity タイプ** を対象 (Run / VirtualRun / Ride など、特定タイプに限定しない)
- 個別 activity の `carbs_ingested` が null の場合、その activity は 0 扱いで合算に含める (activity 自体は計上対象から除外しない)
- 当日 activity が 0 件の場合は `0` を返す (not null)
- **activity データの取得に失敗した場合は `null` を返す** (Critical Invariant セクション参照)

### cal_intake_total

```
cal_intake_total = cal_diet_total + cal_workout_intake
```

- `cal_workout_intake` が null なら `cal_intake_total` も null
- このフィールドが null のときは「intake 不明」として扱う

### Atwater Factor

`× 4 kcal/g` は **Atwater general factor for carbohydrate**。数値は小数精度を保持して返す (例: `carbs_ingested = 110.5g` → `cal_workout_intake = 442.0`)。Consumer 側で表示時に必要な丸めを行う。

---

## Day Boundary Semantics

**Problem being addressed:** timezone 混同に起因する日付ずれが起こりうる。Activity timestamp は `start_date` (UTC) と `start_date_local` (tz-naive local) の 2 系統を持ち、wellness は `YYYY-MM-DD` の tz-naive date。両者の match rule を曖昧にすると、早朝発 long run や深夜 over の活動で日付アサインがブレる。

### Match Rule

**Activity X は wellness date D に対して、以下の条件を満たす場合のみ `cal_workout_intake(D)` に計上される:**

```
activity.start_date_local.date() == D
```

- `start_date_local` は Intervals.icu が提供する tz-naive な現地時刻。Activity が記録された場所の local time を反映する
- Wellness date `D` は tz-naive `YYYY-MM-DD`。athlete の運用上の「その日」を指す
- 両者は tz-naive 同士の直接比較。Timezone 変換は行わない
- これにより Intervals.icu web UI の日付 grouping と完全一致する

### Midnight Crossing

**活動開始日に 100% 計上。比例配分はしない。**

- 例: `start_date_local = 2026-05-01T23:00:00`、duration = 3h (end = 2026-05-02T02:00:00)
  - D=2026-05-01: CHO 全量を計上
  - D=2026-05-02: **計上しない**
- 例: `start_date_local = 2026-05-02T04:00:00`、duration = 4h
  - D=2026-05-02: CHO 全量を計上
  - D=2026-05-01: 計上しない

**比例配分しない理由:**
- Fractional kcal 計算は判定精度を上げない一方、consumer 側の mental model を複雑化する
- Athlete の lived experience (「23:00 発は今日の run」) と整合する
- Intervals.icu web UI と挙動が一致し、UI 表示と分析結果の照合が容易

### Fallback

`start_date_local` が何らかの理由で null / 不在の activity は、`cal_workout_intake` の計算から**除外**する。その activity が存在した事実はログに記録する (warning level)。

`start_date` (UTC) を補完手段として使わない。UTC → local 変換の athlete timezone 情報が MCP 設定に依存しており、timezone 混同の根本原因となる経路を意図的に封じる。

### Out of Scope

- **Athlete の旅行 (別 timezone での活動記録):** 本 FR は単一 timezone 常駐の athlete を想定する。旅先で記録した activity は `start_date_local` が現地時刻になるため、常駐 timezone の wellness date と不一致になる可能性がある。必要に応じて将来 FR で対応する
- **LLM 起動時の「現在時刻」取得:** これは本 FR の scope 外。別途対応が必要

---

## Critical Invariant: `cal_workout_intake` null vs 0

**`cal_workout_intake` の `null` と `0` は意味的に区別される状態であり、consumer は混同してはならない。**

| 値 | 意味 |
|---|---|
| `0` | **確定**: 当該日の activity が 0 件であることを確認した |
| `null` | **不明**: activity データの取得に失敗した (ネットワーク / auth / サーバエラー) |

### Propagation

- `cal_workout_intake = null` ならば `cal_intake_total = null`
- この null は `cal_diet_total` の null 可能性とは独立に伝播する

### Implementation Contract

- Activity fetch が成功し、結果として 0 件だった場合のみ `cal_workout_intake = 0`
- Activity fetch が失敗した場合 (例外、タイムアウト、HTTP エラー) は `cal_workout_intake = null`
- 部分的成功 (一部 activity は取得、一部失敗) の扱いは実装判断に委ねるが、**安全側に倒す場合は null**。実装方針をコードコメントで明記すること

### Rationale

4h+ セッション日で activity CHO を 0 扱いにすると、during 60-80g/h × 4h × 4 kcal/g = 960-1,280 kcal の誤差が intake_kcal に入る。これは energy-availability 系の閾値判定をまたぎうる大きさであり、判定結果を反転させうる。この反転は下流の意思決定 (例: quality session の実行 / 延期) を誤らせる。

Null と 0 を明示的に型レベルで区別することで、consumer 側での silent miscoercion (例: `value || 0`) を構造的に防ぐ。

---

## Null / 0 Semantics (詳細表)

上記の Critical Invariant に加えて、各ソース状況における派生フィールドへの影響:

| ソース側の状況 | 解釈 | 派生フィールドへの影響 |
|---|---|---|
| フィールド未 PUT (null) | 記録忘れ / 未入力 | `cal_diet_total` の合算で 0 扱い、`recorded_count` から**除外** |
| 明示的に 0 を PUT | 食べなかった (明示) | `cal_diet_total` の合算で 0 扱い、`recorded_count` に**含める** |
| 5 フィールドすべて null | 食事記録なし | `cal_diet_total = 0`, `main_meals_complete = false`, `recorded_count = 0` |
| activity データ取得失敗 | intake 不明 | `cal_workout_intake = null`, `cal_intake_total = null` |
| 当日 activity が 0 件 (fetch 成功) | 運動なし (確定) | `cal_workout_intake = 0`, `cal_intake_total = cal_diet_total` |

---

## Scope Discipline

**本 FR は上記 5 フィールドの追加のみを範囲とする。以下は明示的にスコープ外:**

- **時系列派生** (`cal_diet_avg_7d`, `cal_diet_trend_21d_baseline`, `intake_7d_ma` 等): 別 FR
- **Policy / 閾値判定** (`lea30_status`, `ea_vs_lea30` 等): 別 FR、かつ athlete config 依存
- **Write-back** (`kcalConsumed` への自動 PUT 等): データ二重化を避けるため採用しない
- **Activity type filtering** (Run 限定 CHO aggregation 等): 現状の consumer は全タイプ合算を前提とする
- **Activity 編集機能** (`activity.carbs_ingested` の PUT): 既存 activity endpoint で対応可能

これらを追加する場合は別 FR を起こす。実装者は本 FR に記載のない派生フィールドを「便利だから」といった判断で追加しない。

---

## Backward Compatibility

- すべて追加フィールドのみ
- 既存のレスポンスフィールド・ソースデータ・書き込み挙動は一切変更しない
- Consumer 側で派生フィールドを無視しても従来通りの動作

---

## Implementation Notes (suggestions, not requirements)

実装の詳細は本体プロジェクトの判断に委ねる。設計判断の参考として:

- 派生フィールドの計算は wellness レスポンス組み立て時に同期的に実行するのが素直
- Activity データの取得失敗を `cal_workout_intake = null` として区別する実装は、例外ハンドリングが中心となる
- 複数 activity が同日にある場合は単純合算 (セッション境界の考慮は不要)
- Day boundary match は `activity.start_date_local.date()` と `wellness.date` の直接比較。Timezone library は不要

---

## Test Vector Pack

以下 10 ケースを**最低限の受け入れ基準**とする。実装は全ケースで期待値を返すこと。

### TV-01: 全 null、activity なし

**Input:**
- `CalBreakfast = null, CalLunch = null, CalDinner = null, CalSnack1 = null, CalSnack2 = null`
- 当日 activity 0 件 (fetch 成功)

**Expected:**
- `cal_diet_total = 0`
- `cal_diet_main_meals_complete = false`
- `cal_diet_recorded_count = 0`
- `cal_workout_intake = 0`
- `cal_intake_total = 0`

### TV-02: 全 0 明示、activity なし

**Input:**
- `CalBreakfast = 0, CalLunch = 0, CalDinner = 0, CalSnack1 = 0, CalSnack2 = 0`
- 当日 activity 0 件

**Expected:**
- `cal_diet_total = 0`
- `cal_diet_main_meals_complete = true`
- `cal_diet_recorded_count = 5`
- `cal_workout_intake = 0`
- `cal_intake_total = 0`

### TV-03: 主食のみ記録、snack は null

**Input:**
- `CalBreakfast = 600, CalLunch = 800, CalDinner = 900, CalSnack1 = null, CalSnack2 = null`
- 当日 activity 0 件

**Expected:**
- `cal_diet_total = 2300`
- `cal_diet_main_meals_complete = true`
- `cal_diet_recorded_count = 3`
- `cal_workout_intake = 0`
- `cal_intake_total = 2300`

### TV-04: 主食 + activity (CHO あり)

**Input:**
- `CalBreakfast = 600, CalLunch = 800, CalDinner = 900, CalSnack1 = 200, CalSnack2 = null`
- Activity 1 件: `carbs_ingested = 150`

**Expected:**
- `cal_diet_total = 2500`
- `cal_diet_main_meals_complete = true`
- `cal_diet_recorded_count = 4`
- `cal_workout_intake = 600.0`
- `cal_intake_total = 3100.0`

### TV-05: Activity あり、carbs_ingested が null

**Input:**
- `CalBreakfast = 500, CalLunch = 700, CalDinner = 800, CalSnack1 = null, CalSnack2 = null`
- Activity 1 件: `carbs_ingested = null`

**Expected:**
- `cal_diet_total = 2000`
- `cal_diet_main_meals_complete = true`
- `cal_diet_recorded_count = 3`
- `cal_workout_intake = 0` (carbs_ingested null の activity は 0 扱い、fetch 自体は成功しているので null ではない)
- `cal_intake_total = 2000`

### TV-06: 複数 activity、CHO 有無混在

**Input:**
- `CalBreakfast = 600, CalLunch = 800, CalDinner = 900, CalSnack1 = null, CalSnack2 = null`
- Activity 2 件: `#1.carbs_ingested = 100`, `#2.carbs_ingested = null`

**Expected:**
- `cal_workout_intake = 400.0` (100 × 4、null は 0 扱い)
- `cal_intake_total = 2700.0`

### TV-07: Activity fetch failure

**Input:**
- `CalBreakfast = 600, CalLunch = 800, CalDinner = 900, CalSnack1 = null, CalSnack2 = null`
- Activity API 呼び出しが例外を throw / タイムアウト / HTTP エラー

**Expected:**
- `cal_diet_total = 2300` (wellness 取得は成功しているので計算される)
- `cal_diet_main_meals_complete = true`
- `cal_diet_recorded_count = 3`
- `cal_workout_intake = null` ← **Critical**
- `cal_intake_total = null` ← **Critical**

### TV-08: Midnight crossing — 計上日

**Input:**
- Wellness date `D = 2026-05-01`
- Activity: `start_date_local = 2026-05-01T23:00:00`, duration 3h, `carbs_ingested = 50`

**Expected (for D=2026-05-01):**
- `cal_workout_intake = 200.0` (全量計上)

**Expected (for D=2026-05-02):**
- `cal_workout_intake = 0` (開始日ではないので計上しない)

### TV-09: 早朝 activity

**Input:**
- Wellness date `D = 2026-05-02`
- Activity: `start_date_local = 2026-05-02T04:00:00`, duration 4h, `carbs_ingested = 200`

**Expected (for D=2026-05-02):**
- `cal_workout_intake = 800.0`

**Expected (for D=2026-05-01):**
- `cal_workout_intake = 0`

### TV-10: `0` と `null` の混在 (recorded_count / main_meals_complete 判定)

**Input:**
- `CalBreakfast = 500, CalLunch = 600, CalDinner = 0, CalSnack1 = 200, CalSnack2 = null`

**Expected:**
- `cal_diet_total = 1300`
- `cal_diet_main_meals_complete = true` (dinner=0 は non-null、主食 3 食揃っている)
- `cal_diet_recorded_count = 4`

---

## Consumer Guidance (non-normative)

**以下は典型的な consumer 挙動の例示であり、MCP contract ではない。Consumer は独自の policy を持ちうる。**

| 派生フィールドの状態 | 典型的な consumer 側の handling |
|---|---|
| `cal_intake_total = null` | 2-source fetch に fallback、または「intake 不明」で 判定保留 |
| `cal_diet_main_meals_complete = false` | EA 軸を「不明」扱い、HRV × RHR 2 軸判定に戻す |
| `cal_workout_intake = 0` かつ activity が期待される日 | 記録漏れ疑い、ユーザに確認 |
| `cal_diet_recorded_count = 0` かつ過去日 | 記録ギャップ、7d トレンド baseline から除外検討 |
| `cal_diet_recorded_count ≥ 3` かつ `main_meals_complete = true` | EA 軸判定に full confidence |

これらは consumer 側の運用ルールから抽出した例。実装は enforcement を行わない。

---

## Non-goals

以下は本機能要望のスコープ外:

- **EA / LEA 閾値比較 (`ea_vs_lea30` 等) は含めない**
  - 閾値は athlete ごとの FFM 等に依存し、外部設定が必要
  - MCP 側に athlete コンフィグを持たせる設計は責務越境
  - 閾値比較は consumer (LLM) 側で外部 config を読んで実行する
- **`kcalConsumed` への自動 PUT は含めない** (データ二重化を避ける)
- **`activity.carbs_ingested` の編集機能は含めない** (既存 activity endpoint で対応可能)
- **時系列派生 (`cal_diet_avg_7d` 等) は含めない** (別 FR)
- **LLM 起動時の現在時刻取得** (別問題、別 track)
- **旅行時の timezone ハンドリング** (別 FR)

---

## Verification / Acceptance Criteria

実装を accepted として受け入れる条件:

1. Test Vector Pack TV-01 〜 TV-10 全 pass
2. 既存の `get_wellness` 呼び出し (派生フィールド無視) で従来と同一の response (追加フィールド以外)
3. Activity fetch failure シミュレーション (例: ネットワーク切断状態での呼び出し) で `cal_workout_intake = null` が返ることの確認
4. 高負荷日 (複数 / 長時間 activity) の実データで、クライアント側 inline aggregation 値との一致 (±0.01 kcal tolerance、浮動小数誤差のみ許容)

---

## References

- Intervals.icu API docs (wellness endpoint、activity endpoint)

---

## Appendix: client-side aggregation this feature replaces

MCP 派生フィールドが無い場合、クライアント (LLM) 側で以下を実行する必要があった:

```
1. get_wellness(date) で CalBreakfast..CalSnack2 を取得
2. get_activities(date) で carbs_ingested を全 activity で合算
3. intake_kcal = ΣCalXxx + Σ(activity.carbs_ingested) × 4
4. main_meals_complete を判定
5. (任意) 外部 athlete config の閾値と比較
```

本 FR の実装後、手順 1-4 は単一 API 呼び出しで完結する。手順 5 は引き続き consumer 側で実行する (MCP scope 外)。
