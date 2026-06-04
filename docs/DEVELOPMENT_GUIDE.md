# Claude Code 開発ワークフローガイド

## このドキュメントの目的

intervals-mcp-server を Claude Code で開発する際の手順とコツ。
MCPサーバー開発もClaude Code利用も初めてのケースを想定。

## 事前準備

### 1. 開発環境

```bash
# Node.js 18+ 確認
node --version

# プロジェクトディレクトリ作成
mkdir intervals-mcp-server
cd intervals-mcp-server
git init
```

### 2. Claude Code インストール

```bash
npm install -g @anthropic-ai/claude-code
```

### 3. CLAUDE.md を配置

```bash
# このリポジトリの CLAUDE.md をプロジェクトルートにコピー
cp /path/to/CLAUDE.md ./CLAUDE.md
```

**これが最重要ステップ。** Claude Code はプロジェクトルートの `CLAUDE.md` を
自動的に読み込み、プロジェクトのコンテキストとして使用する。
CLAUDE.md がないと、Claude Code は毎回「このプロジェクトは何？」から始まる。

## 開発の進め方

### 原則: 小さく確実に進む

Claude Code に大きなタスクを一度に投げると品質が落ちる。
以下の粒度で1ステップずつ進める。

### Phase 1 の具体的な進行手順

#### Step 1: プロジェクト初期化

Claude Code に投げるプロンプト:

```
package.json, tsconfig.json を CLAUDE.md の仕様に従って作成して。
依存パッケージ: @modelcontextprotocol/sdk, zod
開発依存: typescript, @types/node
```

→ 生成されたら `npm install` を実行して確認。

#### Step 2: 設定ファイル

```
config.ts を作成して。
.env から INTERVALS_ATHLETE_ID と INTERVALS_API_KEY を読み込み、
Zod でバリデーションする。dotenv を使用。
```

→ `.env.example` も作らせる。

#### Step 3: API クライアント

```
core/intervals-client.ts を作成して。
Intervals.icu REST API の Basic Auth クライアント。
CLAUDE.md の「使用エンドポイント」セクションの5つのエンドポイントに対応。
fetch (Node.js 組み込み) を使用。エラーハンドリングを含む。
```

→ ここで **手動テスト** を入れる（後述）。

#### Step 4: 型定義

```
core/types.ts を作成して。
Intervals.icu API のレスポンス型を定義。
ただし API スキーマは変わりうるので、必須フィールドだけ型定義し、
残りは Record<string, unknown> で受ける設計にして。
```

#### Step 5: コアツール（1つずつ）

```
core/tools/get-activities.ts を作成して。
MCP ツールとして get_activities を定義。
パラメータは oldest (string, YYYY-MM-DD) と newest (string, YYYY-MM-DD)。
intervals-client の fetchActivities を呼び出し、
レスポンスから巨大フィールド (raw_json相当、stream_types等) を除外した
軽量版を返す。
```

→ 1ツールずつ作り、次に進む前に動作確認。

#### Step 6: エントリポイント

```
index.ts を作成して。
McpServer を初期化し、core/tools/ 配下の全ツールを登録し、
StdioServerTransport で起動する。
CLAUDE.md のコーディング規約（console.log禁止等）に従うこと。
```

#### Step 7: 動作確認

```bash
npm run build
# Claude Desktop の config に追加して再起動
# Claude Desktop から「先週のアクティビティを取得して」と話しかけてテスト
```

### Phase 2 への移行

Phase 1 が Claude Desktop で動作確認できてから Phase 2 に進む。
**動かないコードの上に機能を積まない。**

```
extensions/stryd/ ディレクトリを作成し、
utils/ema.ts に EMA 計算の汎用関数を実装して。
CLAUDE.md の「LBSS ベース PMC 計算仕様」に従うこと。
単体テストも書いて。
```

## Claude Code との効果的なコミュニケーション

### やるべきこと

1. **1プロンプト1タスク**: 「config.ts を作って」と「テストも書いて」は分ける
2. **具体的なファイル名を指定**: 「API クライアントを作って」ではなく
   「core/intervals-client.ts を作成して」
3. **参照先を明示**: 「CLAUDE.md の PMC 計算仕様に従って」
4. **既存コードへの変更は差分で指示**: 「index.ts に get_wellness ツールの
   登録を追加して。他のツールと同じパターンで」

### 避けるべきこと

1. **一度に全ファイル生成を頼まない**: 品質が落ちる。特に後半のファイルで
   前半のファイルとの整合性が崩れやすい
2. **曖昧な指示**: 「いい感じに作って」→ 具体的な入出力を示す
3. **CLAUDE.md と矛盾する指示**: Claude Code が混乱する原因になる。
   方針変更がある場合は先に CLAUDE.md を更新する

## 手動テストの方法

### API クライアント単体テスト（Phase 1 Step 3 後）

Claude Code に頼まず、自分で確認する部分:

```bash
# 簡単なテストスクリプトを作る
npx tsx -e "
import { IntervalsClient } from './src/core/intervals-client.js';
const client = new IntervalsClient();
const activities = await client.fetchActivities('2026-01-06', '2026-01-12');
console.error(JSON.stringify(activities[0], null, 2));
console.error('Total:', activities.length);
"
```

console.error を使うのは、MCPサーバーは stdout を MCP プロトコルに使うため。

### MCP Inspector でのテスト（推奨）

Claude Desktop に接続する前に、MCP Inspector で単独テスト:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

ブラウザで開いてツールを個別に呼び出せる。

## よくある罠

### Intervals.icu API フィールド名の推測禁止

**これは繰り返し発生した失敗パターン。** Day 2 と Day 5 で同じミスを犯した。

Intervals.icu API のフィールド名は直感的でない命名が多い。
存在しないフィールドを参照してもエラーにならず `undefined` → `null` として
静かに失敗するため、気づきにくい。

**必ず `get_activity_detail` で実データを確認してからコードを書くこと。**

| 推測しがちな名前 | 実際の名前 |
|---|---|
| `avg_power` | `icu_average_watts` |
| `efficiency_factor` | `icu_efficiency_factor` |
| `training_load` | `icu_training_load` |
| `ctl` / `atl` | `icu_ctl` / `icu_atl` |

確認手順:
1. Claude Desktop（または MCP Inspector）で `get_activity_detail` を呼ぶ
2. 実際のJSONの中のフィールド名を目視確認
3. 確認したフィールド名をコードに書く

---

## トラブルシューティング

### Claude Desktop でツールが見えない

- claude_desktop_config.json のパスが正しいか確認
- `npm run build` を忘れていないか
- Claude Desktop を完全に再起動したか（設定変更後は必須）

### API 呼び出しがエラーになる

- .env の INTERVALS_API_KEY が正しいか
- Intervals.icu の Settings → Developer Settings で API キーが有効か
- `console.error()` でレスポンスボディを出力してデバッグ

### stdout に何か出力してしまった

MCP プロトコルが壊れる。console.log() を grep して全て console.error() に置換。

## ファイル構成の最終形（参考）

```
intervals-mcp-server/
├── CLAUDE.md                    # Claude Code 用プロジェクト定義
├── .env                         # 環境変数（gitignore対象）
├── .env.example                 # 環境変数テンプレート
├── .gitignore
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── core/
│   │   ├── intervals-client.ts
│   │   ├── types.ts
│   │   └── tools/
│   │       ├── get-activities.ts
│   │       ├── get-activity-detail.ts
│   │       ├── get-wellness.ts
│   │       └── get-athlete-summary.ts
│   ├── extensions/
│   │   └── stryd/
│   │       ├── lbss-calculator.ts
│   │       ├── types.ts
│   │       └── tools/
│   │           ├── get-weekly-summary.ts
│   │           ├── get-phase-summary.ts
│   │           └── get-current-pmc.ts
│   └── utils/
│       ├── date.ts
│       └── ema.ts
├── build/                       # tsc 出力（gitignore対象）
└── __tests__/
    ├── ema.test.ts
    └── lbss-calculator.test.ts
```
