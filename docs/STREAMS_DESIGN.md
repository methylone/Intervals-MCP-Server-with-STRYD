# Phase 3: Stream Analysis — 設計仕様書

**日付**: 2026-02-26
**目的**: ワークアウトのストリーム（時系列）データを前処理・集計し、Claude が解釈しやすいサマリーを返す `get_activity_streams_summary` ツールを実装する。

---

## 1. 背景と動機

Claude Desktop でワークアウト分析を行う際、生ストリームデータ（1秒刻み × 数千〜万ポイント）をそのまま渡すとトークン爆発を起こす。MCP サーバー側でストリームを取得→クリーニング→分割→集計し、10〜20行のサマリーテーブルとして返すことで、Claude のトークン消費を劇的に削減し、分析の質を上げる。

### ユースケース

- 「今日のロング走のペース/HR ドリフトを見せて」
- 「先月の60分 Easy 3本の EF/Decoupling を比較して」
- 「3時間のトレイルランのどこで脚が終わったか分析して」

---

## 2. API 調査結果（確定事項）

### 2.1 ストリーム取得エンドポイント

```
GET /api/v1/activity/{id}/streams.json
GET /api/v1/activity/{id}/streams.json?types=type1,type2,...
```

- `types` 省略 → 保存済み（stored）ストリームのみ返却
- `types` 明示指定 → **computed ストリームも取得可能**（重要な発見）
- レスポンス形式: `Array<{ type: string, data: number[] }>`

### 2.2 利用可能ストリーム（実データ検証済み）

**types 明示指定で取得可能（computed 含む）:**

| ストリーム名 | 型 | 説明 | 取得方法 |
|:---|:---|:---|:---|
| `time` | number[] | 経過秒（1秒刻み） | stored（デフォルト） |
| `fixed_heartrate` | number[] | スパイク補正済みHR | **types 指定必須** |
| `velocity_smooth` | number[] | 平滑化速度 (m/s) | stored（デフォルト） |
| `distance` | number[] | 累積距離 (m) | stored（デフォルト） |
| `fixed_altitude` | number[] | DEM補正済み標高 (m) | stored（デフォルト） |
| `ga_velocity` | number[] | Grade Adjusted Velocity (m/s) | **types 指定必須** |
| `fixed_watts` | number[] | スパイク補正済みパワー (W) | **types 指定必須** |
| `grade_smooth` | number[] | 平滑化勾配 (%) | **types 指定必須** |
| `cadence` | number[] | ケイデンス (spm) | stored（デフォルト） |
| `temp` | number[] | 気温 (°C) | stored（一部アクティビティのみ） |

**取得不可:**

| ストリーム名 | 状態 | 対処 |
|:---|:---|:---|
| `moving` | API から返らない | velocity_smooth + time gap で自前判定 |

### 2.3 活動詳細の GAP フィールド（参考情報）

`GET /api/v1/activity/{id}` には以下のフィールドが含まれる:

- `gap: 2.326039` (m/s) — 全体 GAP 平均
- `gap_model: "STRAVA_RUN"` — Strava 互換モデル
- `gap_zone_times: [...]` — GAP ベースゾーン分布

### 2.4 time 配列の隙間（重要）

Garmin で手動 PAUSE した区間は **time 配列に隙間（ギャップ）が生じる**。

例: 50:56 → 52:28 で 92 秒間のデータが丸ごと欠落。

これは PAUSE 中にデバイスが記録を停止するため。

**影響**: 分割を「配列インデックスの等分」で実装してはダメ。有効 moving time ベースで分割する必要がある。

---

## 3. 最適ストリーム取得セット

```
?types=time,fixed_heartrate,velocity_smooth,distance,ga_velocity,fixed_watts,grade_smooth,temp,cadence
```

9 ストリーム。デフォルトの全ストリーム取得（14+）と比較して帯域を節約しつつ、computed ストリーム（fixed_heartrate, ga_velocity, fixed_watts, grade_smooth）を確実に取得する。

---

## 4. ツール仕様

### `get_activity_streams_summary`

**配置**: `src/core/tools/get-streams-summary.ts`

パワーデータの有無は自動判定。Stryd/パワーメーターがあれば power 系メトリクスを含め、なければスキップ。

```typescript
// パラメータ
{
  activity_id: string;          // 必須
  split_method?: "auto" | "halves" | "thirds" | "quarters" | "km" | "custom";  // デフォルト: "auto"
  split_breakpoints_m?: number[];  // split_method="custom" 時に必須
  warmup_exclude_sec?: number;  // デフォルト: 600 (10分)
  post_stop_buffer_sec?: number; // デフォルト: 30
}
```

**split_method の "auto" ルール:**

| 分析対象時間 | 分割方式 |
|:---|:---|
| < 90 分 | halves（Friel 互換） |
| 90 分 〜 3 時間 | thirds |
| ≥ 3 時間 | quarters（ウルトラ向け） |

**split_method = "custom" の使い方:**
- `split_breakpoints_m` に距離ブレイクポイント（メートル単位、昇順）を渡す
- 例: `[6000, 12200, 31300]` → 4区間: 0-6km, 6-12.2km, 12.2-31.3km, 31.3km-end
- ラベルは自動生成: `"0-6.0km"`, `"6.0-12.2km"` 等
- `split_method="custom"` なのに `split_breakpoints_m` が未指定の場合はエラー
- ユースケース: レースコースのセグメント境界に合わせた区間分析

**返却値:**

```typescript
interface StreamsSummaryResult {
  activity_id: string;
  activity_name: string;
  total_elapsed_sec: number;        // time 配列の最初〜最後
  total_moving_sec: number;         // 停止除外後の有効時間
  analyzed_sec: number;             // warmup 除外後の分析対象時間

  // 業界標準 — 常に halves（Friel 互換）
  cardiac_decoupling_pct: number;   // Pa:Hr（pace ベース）
  cardiac_decoupling_power_pct: number | null;  // Pw:Hr（パワーベース、あれば）

  // 全体メトリクス（分析対象区間）
  overall: {
    avg_hr: number;
    avg_pace_sec_per_km: number;      // 秒/km
    avg_gap_sec_per_km: number | null; // 秒/km（ga_velocity あれば）
    avg_power: number | null;          // watts（あれば）
    avg_cadence: number | null;
    avg_temp_celsius: number | null;
    avg_grade: number | null;          // grade_smooth の平均 (%)（あれば）
    ef_pace: number;                   // (1000/pace_sec_per_km) / avg_hr
    ef_power: number | null;           // avg_power / avg_hr
  };

  // 分割分析
  split_method: "halves" | "thirds" | "quarters" | "km" | "custom";
  splits: Array<{
    label: string;                     // "H1","H2" / "T1","T2","T3" / "Q1"..."Q4" / "1km","2km"...
    duration_sec: number;
    distance_m: number;
    avg_hr: number;
    avg_pace_sec_per_km: number;
    avg_gap_sec_per_km: number | null;
    avg_power: number | null;
    avg_cadence: number | null;
    avg_grade: number | null;          // 小数2桁 (例: 4.12, -5.37)
    ef_pace: number;
    ef_power: number | null;
  }>;

  // データ品質メタデータ
  data_quality: {
    total_data_points: number;
    time_gaps_detected: number;        // PAUSE による time 配列の隙間
    stop_segments_excluded: number;    // velocity < 0.5 m/s の停止区間数
    stopped_time_excluded_sec: number;
    warmup_excluded_sec: number;
    post_stop_buffer_excluded_sec: number;
    clean_data_ratio: number;          // analyzed_sec / total_moving_sec
    has_power: boolean;
    has_gap: boolean;
    has_temp: boolean;
    has_grade: boolean;
  };
}
```

---

## 5. ストリーム処理パイプライン

### Stage 1: データ取得

```
intervals-client.getActivityStreams(activityId, STREAM_TYPES)
→ 9 ストリームの配列を取得
→ type→data のマップに変換
```

### Stage 2: 停止区間検出 & 有効データマーキング

```
入力: time[], velocity_smooth[]
出力: validMask[] (boolean)  — true = 分析対象

Step 2a: time 配列のギャップ検出
  - time[i+1] - time[i] > 5秒 → PAUSE 区間として記録
  - PAUSE 区間前後のデータは存在しないのでスキップ不要
  - ただし PAUSE 直後の vel=0 区間は Step 2b で処理される

Step 2b: velocity ベースの停止検出
  - velocity_smooth[i] < 0.5 m/s → stopped = true
  - 停止が連続していたら1つの停止区間として扱う
  ※ 秒数ではなく「連続データポイント」で判定（time にギャップがあるため）

Step 2c: 復帰バッファ
  - 停止区間の終了後、post_stop_buffer_sec 分のデータポイントを無効化
  - デフォルト: 30秒

Step 2d: ウォームアップ除外
  - 最初の warmup_exclude_sec 分のデータポイントを無効化
  - デフォルト: 600秒（10分）

結果: validMask[i] = true のデータポイントだけが分析対象
```

### Stage 3: 有効データの抽出

```
validMask で全ストリームをフィルタ
→ 有効データのみの配列群を生成
→ analyzed_sec = 有効データ中の time のレンジ（ギャップ除外）
```

### Stage 4: moving time の計算

```
有効データの各隣接ポイント間の時間差を合計する。
ただし、time 配列に 5 秒以上のギャップがある場合はそのギャップを加算しない。

moving_time = Σ min(time[i+1] - time[i], 5) for all valid adjacent points
```

### Stage 5: 分割

```
分割基準: moving time ベース（有効データ時間の等分）

1. 有効データの総 moving time を算出
2. 分割数（N）を決定（auto ルールまたは指定値）
3. 目標区間時間 = total_moving_time / N
4. 有効データを走査し、累積 moving time が目標に達したら次の split へ
5. km 分割の場合は distance ベースで 1000m ごとに分割
6. custom 分割の場合は splitByBreakpoints() で不等間隔の距離ブレイクポイントで分割
```

### Stage 6: 集計

```
各 split について:
  - avg_hr = mean(fixed_heartrate[split_range])
  - avg_velocity = mean(velocity_smooth[split_range])  → pace 変換
  - avg_gap_velocity = mean(ga_velocity[split_range])  → pace 変換（null if absent）
  - avg_power = mean(fixed_watts[split_range])          （null if absent）
  - avg_cadence = mean(cadence[split_range])            （null if absent）
  - ef_pace = (1000 / pace_sec_per_km) / avg_hr
  - ef_power = avg_power / avg_hr                       （null if absent）
  - avg_grade = mean(grade_smooth[split_range])         （null if absent）
```

### Stage 7: Cardiac Decoupling（常に halves）

```
有効データの前半/後半を分割（moving time ベース）
  H1_ef = avg_velocity_H1 / avg_hr_H1
  H2_ef = avg_velocity_H2 / avg_hr_H2
  decoupling_pace = (H1_ef - H2_ef) / H1_ef × 100

パワーがあれば:
  H1_ef_pw = avg_power_H1 / avg_hr_H1
  H2_ef_pw = avg_power_H2 / avg_hr_H2
  decoupling_power = (H1_ef_pw - H2_ef_pw) / H1_ef_pw × 100
```

---

## 6. intervals-client.ts 拡張

```typescript
/**
 * GET /api/v1/activity/{id}/streams.json?types=...
 */
async getActivityStreams(
  activityId: string,
  types?: string[]
): Promise<Array<{ type: string; data: (number | null)[] }>>
```

- `types` 省略 → 全ストリーム取得（非推奨、帯域大）
- `types` 指定 → `?types=type1,type2,...` で必要なストリームのみ取得

**デフォルトストリームセット定数:**

```typescript
const STREAMS_SUMMARY_TYPES = [
  'time', 'fixed_heartrate', 'velocity_smooth', 'distance',
  'ga_velocity', 'fixed_watts', 'grade_smooth', 'temp', 'cadence'
] as const;
```

---

## 7. 型定義の追加（types.ts）

```typescript
// ---------------------------------------------------------------------------
// Activity Streams (GET /activity/{id}/streams.json)
// ---------------------------------------------------------------------------

export type ActivityStreamRaw = {
  type: string;
  data: (number | null)[];
};
```

---

## 8. ファイル構成

```
src/
├── core/
│   ├── intervals-client.ts          # getActivityStreams() 追加
│   ├── types.ts                     # ActivityStreamRaw 追加
│   └── tools/
│       └── get-streams-summary.ts   # 新規: MCP ツール定義
├── utils/
│   └── stream-processing.ts         # 新規: ストリーム処理ユーティリティ
└── index.ts                         # get_activity_streams_summary 登録追加
```

### `utils/stream-processing.ts` の関数

```typescript
// ストリーム配列 → type→data マップ変換
function streamsToMap(streams: ActivityStreamRaw[]): Map<string, (number | null)[]>

// 停止区間検出 + 有効データマスク生成
function buildValidMask(
  time: number[],
  velocity: (number | null)[],
  options: { warmupExcludeSec: number; postStopBufferSec: number }
): {
  validMask: boolean[];
  timeGaps: number;          // PAUSE による time ギャップ数
  stopSegments: number;      // 停止区間数
  stoppedTimeSec: number;    // 停止除外時間合計
  bufferTimeSec: number;     // バッファ除外時間合計
}

// 有効データの moving time 計算
function calcMovingTime(time: number[], validMask: boolean[]): number

// moving time ベースの分割（N等分）
function splitByMovingTime(
  time: number[],
  validMask: boolean[],
  numSplits: number
): Array<{ startIdx: number; endIdx: number }>

// km ベースの分割
function splitByDistance(
  distance: (number | null)[],
  validMask: boolean[],
  intervalMeters: number    // デフォルト 1000
): Array<{ startIdx: number; endIdx: number }>

// 区間平均計算（null をスキップ）
function avgInRange(data: (number | null)[], mask: boolean[], start: number, end: number): number | null

// カスタム距離ブレイクポイントで分割（splitByDistance の不等間隔版）
function splitByBreakpoints(
  distance: (number | null)[],
  validMask: boolean[],
  breakpoints: number[]    // メートル単位、昇順
): Array<{ startIdx: number; endIdx: number }>

// 速度(m/s) → ペース(秒/km) 変換
function velocityToPace(velocityMs: number): number

// Cardiac Decoupling 計算（halves 固定）
function calcDecoupling(
  time: number[],
  hr: (number | null)[],
  metric: (number | null)[],   // velocity or power
  validMask: boolean[]
): number | null
```

---

## 9. テスト戦略

### 9.1 `__tests__/stream-processing.test.ts`

**buildValidMask のテスト:**

```
- 全データ有効（停止なし、ウォームアップなし）→ 全 true
- velocity < 0.5 が 10 秒以上 → 停止区間 + バッファが false
- time にギャップあり（PAUSE）→ ギャップ直後の vel=0 も false
- warmup 10 分除外 → 最初 600 秒が false
- 短い停止（5秒未満）→ 無視される（閾値以下）
- 停止区間のカウントが正しい
```

**calcMovingTime のテスト:**

```
- 連続データ（ギャップなし）→ time[-1] - time[0]
- time にギャップあり → ギャップ部分は加算されない
- 停止除外後のデータ → 有効ポイント間の合計
```

**splitByMovingTime のテスト:**

```
- 120 秒のデータを halves → 60 秒ずつ
- ギャップをまたぐ分割 → moving time ベースで正しく分割
- 3時間データを quarters → 各 45 分
```

**splitByDistance のテスト:**

```
- 10km のデータを 1km 分割 → 10 セグメント
- 端数処理（最後が 1km 未満）
```

**calcDecoupling のテスト:**

```
- 一定 HR/velocity → decoupling ≈ 0%
- 後半 HR 上昇 → 正の decoupling
- 後半 velocity 低下 → 正の decoupling
```

### 9.2 実データ検証

実装完了後、以下の 3 パターンで検証:

1. **Easy 60min**（activity ID: 既知）
   - Intervals.icu UI の decoupling 値と突合
   - `split_method: "halves"` で EF の前半/後半比較

2. **トレイルラン 3h**（activity ID: 既知）
   - 停止区間 10 箇所の検出
   - GAP と実ペースの乖離確認（トレイルなので大きいはず）
   - `split_method: "quarters"` で疲労パターン可視化

3. **トレッドミル**（activity ID: 既知）
   - latlng なし、temp なし → 正常にスキップされるか
   - 先頭の velocity=0 → ウォームアップ除外で処理されるか

---

## 10. Claude Code 実装ステップ

### Step 1: types.ts に ActivityStreamRaw 追加

```
src/core/types.ts に ActivityStreamRaw 型を追加して。
コメントに「GET /activity/{id}/streams.json のレスポンス」と記載。
既存の型は変更しないこと。
```

### Step 2: intervals-client.ts に getActivityStreams() 追加

```
src/core/intervals-client.ts に getActivityStreams() メソッドを追加して。

シグネチャ:
  async getActivityStreams(
    activityId: string,
    types?: string[]
  ): Promise<ActivityStreamRaw[]>

- GET /api/v1/activity/{activityId}/streams.json
- types があれば ?types=type1,type2,... をクエリパラメータに追加
- 既存の fetchActivity(), fetchActivities() と同じパターンで実装
- エラーハンドリングも同じパターン
```

### Step 3: stream-processing.ts ユーティリティ + テスト

```
src/utils/stream-processing.ts を作成して。
STREAMS_DESIGN.md のセクション 8「utils/stream-processing.ts の関数」に
定義された全関数を実装。

同時に __tests__/stream-processing.test.ts を作成。
STREAMS_DESIGN.md のセクション 9.1 のテストケースを実装。
```

### Step 4: get-streams-summary.ts ツール実装

```
src/core/tools/get-streams-summary.ts を作成して。
STREAMS_DESIGN.md のセクション 4「ツール仕様」と
セクション 5「ストリーム処理パイプライン」に従って実装。

MCP ツール定義:
  name: "get_activity_streams_summary"
  パラメータ: activity_id (required), split_method, warmup_exclude_sec, post_stop_buffer_sec

内部フロー:
  1. intervals-client.getActivityStreams() でストリーム取得
  2. stream-processing の関数を使ってクリーニング→分割→集計
  3. StreamsSummaryResult を JSON で返却

STREAMS_SUMMARY_TYPES 定数はこのファイルで定義:
  ['time', 'fixed_heartrate', 'velocity_smooth', 'distance',
   'ga_velocity', 'fixed_watts', 'grade_smooth', 'temp', 'cadence']
```

### Step 5: index.ts にツール登録

```
src/index.ts に get_activity_streams_summary ツールの登録を追加して。
他のツールと同じパターンで。
```

### Step 6: ビルド確認

```
npm run build でビルドが通ることを確認。
npm test でテストが全て通ることを確認。
```

---

## 11. 設計判断の根拠

### なぜ core/ に配置するか

パワーデータの有無は自動判定（`fixed_watts` が null なら power 系をスキップ）。
Stryd 固有のメトリクス（GCT, LSS, Vertical Oscillation）は将来の extensions/ hook として
予約するが、Phase 3 では実装しない。core ツールとして汎用的に使える。

### なぜ moving time ベースで分割するか

1. time 配列に PAUSE ギャップがあるため、elapsed time 等分だと分割比率が狂う
2. 配列インデックス等分も同じ理由でダメ
3. 「実際に走っていた時間」で等分するのが、生理学的に意味のある分割

### なぜ cardiac decoupling は常に halves か

Joe Friel のオリジナル定義が halves。TrainingPeaks, Intervals.icu, WKO 全てが halves。
MCP サーバーの値と Intervals.icu UI の値が一致することが信頼性の基盤。

### トレイルランでは pace-based decoupling は無意味（実データ検証済み）

平地ロードでは Pa:Hr（pace ベースデカップリング）が有効だが、
**トレイルランでは地形による速度変動が大きいため、pace-based decoupling は意味をなさない。**

- 急登では velocity が激減し、HR が高い状態でも EF が著しく低下する
- 激下りでは velocity が上昇し、HR が低くても EF が上振れする
- これらは走力や有酸素能力の変化ではなく、純粋に地形の影響

**実用指針**: トレイルランの解析では `cardiac_decoupling_pct`（pace ベース）は無視し、
`cardiac_decoupling_power_pct`（Pw:Hr、パワーベース）のみを参照すること。
Stryd パワーは傾斜を内包するため、トレイルでも有酸素ドリフトを正確に捉えられる。

Claude がトレイルランを分析する際は、decoupling の解釈において必ずこの区別を行うこと。

### なぜ復帰バッファは 30 秒か

92 秒停止後のデータでは HR 完全復帰に 50 秒かかることを確認済み。
しかし EF/Decoupling は数十分スパンの平均なので、復帰途中の 10-15 秒の低 HR は
全体平均への影響が軽微。有効データを削りすぎるリスクとのバランスで 30 秒。
パラメータ化してあるので、必要に応じて調整可能。

### なぜ GAP を自前計算しないか

Intervals.icu が `ga_velocity` ストリームとして提供していることが API 調査で確定。
`gap_model: "STRAVA_RUN"` で Strava 互換。自前計算は精度のずれリスクがあり、
メンテコストも高い。Intervals.icu に任せるのが正解。

### Halves decoupling は連続走専用（実データ検証済み）

Halves decoupling は連続走（Easy, LSD, テンポ単発, レース）での有酸素ドリフト評価に設計されている。
構造化インターバル（例: 2×20min テンポ）に適用すると以下の問題が発生する:

- ウォームアップ（低 HR・低出力）が H1 の EF を歪める
- セット間レストが分割境界に不確定に混入する
- クールダウン（低出力・高疲労 HR）が H2 の EF を歪める

**実データ検証（2×20min 6% Hill Tempo, 構造化インターバルの実走サンプル）:**

| 条件 | Pw:Hr decoupling | 解釈 |
|:---|:---|:---|
| warmup=0, buffer=0（全データ） | 2.22% | WU/CD の影響でドリフトが希釈 |
| warmup=600, buffer=30（デフォルト） | 6.06% | テンポブロックのドリフトだがCDも混入 |
| Intervals.icu UI | -0.9% | WU の低 EF が H1 を引き下げ、見かけ上負のデカップリング |
| 実態（LAP データより） | テンポ#1: HR 150, テンポ#2: HR 150 | ブロック間ドリフトはほぼなし。ブロック内ドリフトが本質 |

**運用指針**: 構造化ワークアウトでは halves decoupling を使わず、`split_method: "km"` で
ブロック構造を可視化し、テンポブロック対ブロック比較を人間または Claude が行うこと。

---

## 12. 将来の拡張ポイント（Phase 3 には含めない）

- **Stryd ランニングダイナミクス**: GCT, LSS, Vertical Oscillation のストリーム分析
  → `extensions/stryd/tools/get-running-dynamics.ts` として独立実装
- **km 分割のペースドリフト可視化**: split テーブルの CSV/チャート出力
- **温度補正**: temp ストリームを使った暑熱下パフォーマンス評価
- **search_similar_activities**: 同条件ワークアウトの自動検索 + 比較
- **compare_activities**: 複数アクティビティの streams summary を並列比較
- **Intervals.icu LAP/Intervals API**: UI で表示される自動ブロック検出結果を API 経由で取得。
  構造化インターバルのブロック対ブロック比較、ブロック内デカップリング、WU vs CD の HR 比較を自動化。
  km 分割では検出できない短いレスト区間（3分以下）の境界も正確に取得可能。
