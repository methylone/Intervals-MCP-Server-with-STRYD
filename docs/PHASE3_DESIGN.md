# Phase 3 設計仕様書: get_phase_summary + search_similar_activities

**作成日**: 2026-02-27
**作成者**: Claude Opus 4.6 (設計) → Claude Code (実装)

---

## 概要

Phase 3 は2つのツールを追加し、Phase 3 全体を完了させる。

| ツール | 配置 | 目的 |
|--------|------|------|
| `get_phase_summary` | `extensions/stryd/tools/` | フェーズ期間の週別推移と ramp rate |
| `search_similar_activities` | `core/tools/` | 過去の類似セッション検索（推定値の根拠づけ） |

**注**: `get_activity_streams_summary` は既に Phase 3 で実装済み。
これら2つで Phase 3 は完了。

---

## Tool 1: get_phase_summary

### 配置

`src/extensions/stryd/tools/get-phase-summary.ts`

（ファイルは既に `get-phase-summary.ts` として存在するかもしれないが中身は未実装。
存在する場合は上書き。）

### パラメータ

```typescript
{
  start_date: string,  // フェーズ開始日 (YYYY-MM-DD, 月曜日)
  end_date: string,    // フェーズ終了日 (YYYY-MM-DD, 日曜日)
  phase_name?: string  // フェーズ名（任意、返り値に含めるだけ。フィルタには使わない）
}
```

### 返り値

```typescript
{
  phase_name: string | null,
  start_date: string,
  end_date: string,
  total_weeks: number,
  
  // フェーズ全体の合計
  phase_totals: {
    rss: number,
    lbss: number,
    time_min: number,
    distance_km: number,
    session_count: number,
  },

  // 週別サマリー配列（昇順）
  weeks: [
    {
      week_start: string,
      totals: { rss, lbss, time_min, distance_km },
      session_count: number,
      averages: { ilr, decoupling },
      pmc_end_of_week: {
        rss: { ctl, atl, tsb },
        lbss: { ctl, atl, tsb },
      },
    },
    // ...
  ],

  // 週間変化率（ramp rate 分析用）
  trends: {
    rss_weekly: number[],    // 各週のRSS合計
    lbss_weekly: number[],   // 各週のLBSS合計
    rss_ctl_series: number[],  // 各週末のRSS CTL
    lbss_ctl_series: number[], // 各週末のLBSS CTL
    rss_ramp_rate: number | null,   // CTL の週平均変化（最終週CTL - 初週CTL）/ 週数
    lbss_ramp_rate: number | null,  // 同上 LBSS版
  },
}
```

### 設計判断

**`get_weekly_summary` のロジックを再利用するか、API を直接叩くか？**

`get_weekly_summary` を N 回呼ぶと、毎回 180 日分の activities を取得するため
API コールが N 回発生する。フェーズが 8 週なら 8 回。

→ **API を直接叩いて、1 回の activities 取得で全週分を処理する。**

具体的には:
1. `getActivities(warmupStart, end_date)` を 1 回呼ぶ（warmupStart = start_date - 180 日）
2. `getWellness(start_date, end_date)` を 1 回呼ぶ
3. activities を週ごとにグループ化
4. 各週の集計を計算（`get_weekly_summary` と同じロジック）
5. PMC は通し計算（EMA は全期間を通して 1 回計算し、各週末のスナップショットを取る）

PMC 計算について:
- RSS 系: wellness データから各週末の ctl/atl を取得
- LBSS 系: `computeLbssPmc(allActivities, warmupStart, end_date)` を 1 回呼び、
  各週日曜の値を抽出

**ユーティリティの再利用:**
- `computeLbssPmc` from `lbss-calculator.ts` — そのまま使用
- `round`, `avg`, `collectNumbers` — `get-weekly-summary.ts` と同じヘルパー
  → これらが現在ファイルローカルなら、共有ユーティリティに切り出す必要があるか確認

### 実装ステップ

**Step 1**: `get-phase-summary.ts` を作成。
`get-weekly-summary.ts` のパターンに従い、MCP ツールとして登録。

**Step 2**: `index.ts` にツール登録を追加。

**Step 3**: テストは実データ検証で行う（ユニットテストは PMC 計算部分が
既存テストでカバー済みのため、結合テスト中心）。

---

## Tool 2: search_similar_activities

### 配置

`src/core/tools/search-similar-activities.ts`

Core に配置する理由: Stryd/LBSS に依存しない汎用的なフィルタリング機能。

### パラメータ

```typescript
{
  oldest: string,           // 検索期間の開始日 (YYYY-MM-DD)
  newest: string,           // 検索期間の終了日 (YYYY-MM-DD)
  type?: string,            // アクティビティ種別フィルタ (e.g. "Run", "VirtualRun")
  name_contains?: string,   // ワークアウト名の部分一致フィルタ (case-insensitive)
  distance_min_km?: number, // 最小距離 (km)
  distance_max_km?: number, // 最大距離 (km)
  duration_min_minutes?: number,  // 最小時間 (分)
  duration_max_minutes?: number,  // 最大時間 (分)
  sort_by?: string,         // ソートキー: "date" (default), "distance", "rss", "lbss"
  limit?: number,           // 最大返却数 (default: 20)
}
```

### 返り値

```typescript
{
  query: {
    oldest: string,
    newest: string,
    filters_applied: string[],  // 適用されたフィルタの説明（例: ["type=Run", "distance: 10-15km"]）
  },
  total_matched: number,
  activities: [
    {
      id: string,
      date: string,
      name: string,
      type: string,
      distance_km: number,
      duration_min: number,
      rss: number | null,
      lbss: number | null,
      ilr: number | null,
      avg_hr: number | null,
      avg_power: number | null,
      pace_per_km: string | null,   // "5:30" 形式
      decoupling: number | null,
      efficiency_factor: number | null,
    },
    // ...
  ],
  // 集合統計（マッチしたアクティビティ全体の要約）
  summary: {
    avg_rss: number | null,
    avg_lbss: number | null,
    avg_duration_min: number,
    avg_distance_km: number,
    avg_ilr: number | null,
  },
}
```

### 設計判断

**Intervals.icu API にサーバーサイドフィルタがないことを確認済み。**
`GET /athlete/{id}/activities?oldest=...&newest=...` で全アクティビティを取得し、
クライアントサイドでフィルタする。

**pace_per_km の計算:**
`moving_time / (distance / 1000)` で秒/km を算出し、`"M:SS"` 形式に変換。
これは `stream-processing.ts` にある `formatPace` 的なヘルパーが使えるか確認。
なければ簡単なフォーマッタを書く。

**efficiency_factor:**
Intervals.icu の API フィールドにはないことが Day 2 で判明済み。
ただし `avg_power / avg_hr` で計算可能（power と hr が両方あるアクティビティのみ）。

**name_contains の用途:**
"Easy" "Tempo" "Hill" "LR" "Long Run" "Trail" "トレイル" など、
ワークアウト名に含まれるキーワードでフィルタ。これが最も実用的な検索軸。
実際のユースケース: 「過去のEasy 60-80分のセッションのLBSS平均は？」

**summary の意義:**
リスケジュール時に「Easy 2.5h のLBSS推定値」が欲しい場面で、
search_similar_activities の summary.avg_lbss がそのまま使える。

### 実装ステップ

**Step 1**: `search-similar-activities.ts` を作成。
`get-activities.ts` のパターンを参考に、フィルタロジックを追加。

**Step 2**: `index.ts` にツール登録を追加。

**Step 3**: ビルド確認 + 実データ検証。

---

## CC への実装指示

### 注意事項（過去の教訓から）

1. **`round` ヘルパー**: null を受け取った場合に null を返す版を使うこと。
   `get-weekly-summary.ts` にある実装を参照。
   もしファイルローカルなら、`utils/math.ts` 等に切り出しても良い。

2. **console.log() 禁止**: stdio を壊す。デバッグは console.error() のみ。

3. **テスト**: `npm test` で既存の 97 テストが全てパスすることを確認してから PR。

4. **型**: `Activity` 型は `core/types.ts` にある。新しいフィールドを使う場合は
   型定義を確認・追加。

5. **date ユーティリティ**: `utils/date.ts` の `addDays`, `dateRange`, `toWeekStart` を活用。

### ステップ分割（CC に1つずつ投げる）

| Step | タスク | ファイル |
|------|--------|---------|
| 1 | `get-phase-summary.ts` 実装 | `src/extensions/stryd/tools/get-phase-summary.ts` |
| 2 | index.ts にツール登録追加 (phase_summary) | `src/index.ts` |
| 3 | `search-similar-activities.ts` 実装 | `src/core/tools/search-similar-activities.ts` |
| 4 | index.ts にツール登録追加 (search) | `src/index.ts` |
| 5 | ビルド + テスト確認 | `npm run build && npm test` |
| 6 | Ubuntuサーバーにデプロイ + 実データ検証 | systemd restart + Claude Desktop で確認 |

---

## 実データ検証計画

### get_phase_summary

テストケース: 任意の連続ブロック（例: 7 週間のトレーニングブロック）
- 期間: 7 週
- 期待: 週別 RSS/LBSS が計画シートの実績値と一致
- CTL ramp rate: ブロック開始 → 終了で CTL が単調増加（例: +2〜3/週相当）

### search_similar_activities

テストケース1: `{ type: "Run", name_contains: "Easy", duration_min_minutes: 55, duration_max_minutes: 75, oldest: "2025-01-06", newest: "2025-03-30" }`
- 期待: Easy 60-72分のセッションが返る
- summary.avg_lbss が Easy 1h の LBSS 推定値として使える

テストケース2: `{ name_contains: "Trail", oldest: "2025-01-06", newest: "2025-03-30" }`
- 期待: トレイルセッションのみ返る

テストケース3: `{ name_contains: "Tempo", oldest: "2025-01-06", newest: "2025-03-30" }`
- 期待: テンポ走セッションのみ返る、RSS/LBSS比率が Easy より低い

---

## CLAUDE.md 更新

Phase 3 完了後、CLAUDE.md の開発フェーズセクションを以下に更新:

```markdown
### Phase 3: ストリーム分析 + フェーズ分析 ✅
- [x] types.ts に ActivityStreamRaw 追加
- [x] intervals-client.ts に getActivityStreams() 追加
- [x] utils/stream-processing.ts + テスト
- [x] core/tools/get-streams-summary.ts
- [x] core/tools/search-similar-activities.ts
- [x] extensions/stryd/tools/get-phase-summary.ts
- [x] 実データ検証

### Phase 4: 将来の拡張（未着手）
- [ ] get_events ツール（計画ワークアウト取得、計画 vs 実績比較用）
- [ ] get_hrss_rss_ratio（HR/Power比率分析）
- [ ] get_metric_trend（メトリクスのトレンド分析）
```

STATUS.md のファイル構成にも追加:
```
│   └── tools/
│       ├── get-activities.ts
│       ├── get-activity-detail.ts
│       ├── get-wellness.ts
│       ├── get-athlete-summary.ts
│       ├── get-streams-summary.ts
│       └── search-similar-activities.ts   # ⭐ Phase 3 追加
```
