[English](INSTALL.md) | 日本語

# インストールとセットアップ

このガイドは、ゼロの状態から、AI クライアントに接続された動作する Intervals.icu MCP
サーバを構築するまでを案内します。内容は十分に明示的なので、このリポジトリの URL を
AI アシスタントに渡してセットアップを代行させることもできます（[AI に任せてインストールする](#ai-に任せてインストールする)
を参照）。

## 前提条件

- **Node.js >= 20.6**（サーバは組み込みの `--env-file` フラグを使用します）。`node --version`
  で確認してください。
- **Intervals.icu アカウント**と **API key**：intervals.icu の *Settings → Developer* で
  API key をコピーします。
- **あなたの athlete ID**：自分のカレンダー/プロフィールを表示しているときに Intervals.icu の
  URL に表示されます（`i12345678` のような短い文字列）。athlete ID に `0` を指定することもでき、
  これは「この API key の所有者」を意味します。
- **（任意）Stryd エクステンション。** `get_current_pmc`、`get_weekly_summary`、
  `get_phase_summary` の各ツールは Stryd の負荷指標（LBSS / ILR）を使用します。これらには
  Stryd パワーメーター**と**、対応する Intervals.icu のカスタムフィールド（例: `StrydLBSSmod`）が
  アクティビティに存在することが必要です。**コアツールは Stryd なしでも動作します** — エクステンションは
  パワーベースの PMC を上乗せするだけです。
- **（任意）天候メトリクス。** `search_similar_activities` が使用する `average_feels_like` の値は、
  Intervals.icu の Open-Meteo エンリッチメントに由来します。温度フィルタを設定すると、天候データの
  ないアクティビティは除外されます。

## セットアップ

```bash
# 1. Clone
git clone <this-repository-url> intervals-mcp-server
cd intervals-mcp-server

# 2. Install dependencies
npm install

# 3. Create your .env from the template and fill in your values
cp .env.example .env
#   then edit .env:
#     INTERVALS_API_KEY=...        (from Settings > Developer)
#     INTERVALS_ATHLETE_ID=i12345678  (or 0)
#     ATHLETE_TIMEZONE=Asia/Tokyo  (optional; default UTC)

# 4. Build
npm run build
```

`npm run build` は TypeScript を `build/` にコンパイルします。サーバのエントリポイントは
`build/index.js` になります。

ビルドの動作確認には `npm test`（ユニットテスト一式を実行）が使えます。stdio の場合は
`npm run dev`（`tsx` でソースから直接実行）も利用できます。

### 任意の設定

任意の環境変数はすべて `.env.example` に記載されています。特筆すべきものが 2 つあります。

- **`ATHLETE_TIMEZONE`** — IANA 名（例: `Asia/Tokyo`）。デフォルトは `UTC`。「今日」の判定と
  月〜日の週境界に影響します。
- **`CACHE_DIR`** — ディスク上のアクティビティストリームキャッシュのディレクトリ。**絶対パスを
  推奨**します。起動時のワーキングディレクトリはクライアントやホスト（Claude Desktop、Codex、
  Linux サーバ）によって異なるため、相対パスだとクライアントごとに別々のキャッシュへ解決されて
  しまうからです。未設定の場合は、起動ディレクトリではなくサーバ自身の位置から解決した絶対パス
  `<server install>/cache/streams` がデフォルトになります。いつフラッシュすべきか（FIT 再アップロード /
  標高補正 → `clear_cache` ツール）は [ARCHITECTURE.md](ARCHITECTURE.md#caching) を参照してください。
- **`CACHE_ENABLED`** — `true`（デフォルト）または `false`。`false` にするとストリームキャッシュを
  完全にバイパスします（常に新規取得）。チャットから `set_cache_enabled` ツールでランタイムに
  切り替えることもできます。ランタイムの状態は再起動時にこの値へ戻ります。

## クライアントの接続

クライアント設定では絶対パスを使用してください。`/absolute/path/to/intervals-mcp-server` を実際の
チェックアウトパスに置き換え、自分の認証情報を使用します。

### Claude Desktop — stdio（推奨）

`claude_desktop_config.json` を編集します
（macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`）:

```json
{
  "mcpServers": {
    "intervals": {
      "command": "node",
      "args": ["/absolute/path/to/intervals-mcp-server/build/index.js"],
      "env": {
        "INTERVALS_API_KEY": "your_api_key_here",
        "INTERVALS_ATHLETE_ID": "i12345678",
        "ATHLETE_TIMEZONE": "Asia/Tokyo"
      }
    }
  }
}
```

Claude Desktop を再起動すると、`intervals` のツールが表示されるはずです。

### Codex CLI — stdio

Codex は設定ファイル（例: `~/.codex/config.toml`）から MCP サーバを読み込みます。stdio の
エントリは次のようになります:

```toml
[mcp_servers.intervals]
command = "node"
args = ["/absolute/path/to/intervals-mcp-server/build/index.js"]
env = { INTERVALS_API_KEY = "your_api_key_here", INTERVALS_ATHLETE_ID = "i12345678", ATHLETE_TIMEZONE = "Asia/Tokyo" }
```

（正確なスキーマは、お使いのクライアントの最新の MCP ドキュメントを参照してください — 上記の形は
stdio MCP サーバ設定の代表例です。）

> **Codex の STDIO に関する注意。** Codex と Claude Desktop では、stdio MCP サーバの設定 UI が
> 異なります。Codex では、コマンドの引数を**別々の値**として入力する必要があります — 引数 1 つに
> つき 1 エントリです（上記の `args = [ … ]` 配列のとおり）。引数リスト全体を 1 つのフィールドに
> 1 つの結合文字列としてまとめて貼り付けると動作しません。Codex はそれを単一のリテラル引数として
> 渡すため、起動に失敗します。これは `args` が複数の要素を持つとき（例:
> `["--env-file", ".env", "build/index.js"]`）に影響します。

### HTTP モード（上級者向け — 先に SECURITY を読むこと）

> ⚠️ Streamable HTTP モードには**アプリケーション層の認証がなく**、`0.0.0.0` にバインドします。
> 信頼できるネットワーク / VPN（例: Tailscale）の内部でのみ実行し、**公開インターネットには絶対に
> 公開しないでください**。[SECURITY.ja.md](SECURITY.ja.md) を参照してください。

HTTP モードでサーバを起動します:

```bash
MCP_TRANSPORT=http node --env-file .env build/index.js          # default port 8080
MCP_TRANSPORT=http MCP_PORT=3000 node --env-file .env build/index.js
```

Claude Desktop は HTTP MCP サーバに直接接続しません。`mcp-remote` でブリッジします。エンドポイントが
HTTPS でないため `--allow-http` が必要です:

```json
{
  "mcpServers": {
    "intervals": {
      "command": "npx",
      "args": ["mcp-remote", "http://<server-host-on-your-vpn>:8080/mcp", "--allow-http"]
    }
  }
}
```

サーバ上で 24/7 稼働させ続けるには、`systemd` のようなプロセスマネージャの下で実行します
（`node build/index.js` を `Environment=MCP_TRANSPORT=http` と、`.env` を指す `EnvironmentFile`
付きで実行する `simple` サービス）。

## AI に任せてインストールする

このリポジトリは自己記述的なので、セットアップを委譲できます:

1. AI アシスタント（Claude / Codex）にこのリポジトリの URL を渡し、`README.md`、この `INSTALL.md`、
   `ARCHITECTURE.md` を読むよう依頼します。
2. clone・`npm install`・`.env.example` からの `.env` 作成・`npm run build` を依頼します。API key と
   athlete ID は尋ねられたら渡します（自分が管理していない、共有・ログ記録されるチャットに秘密情報を
   貼り付けないこと）。
3. お使いのクライアント（Claude Desktop / Codex）向けに、絶対パスを埋めたクライアント設定ブロックを
   出力するよう依頼します。
