[English](INSTALL.md) | 日本語

# インストールとセットアップ

このガイドは、ゼロの状態から、AI クライアントに接続された動作する Intervals.icu MCP
サーバを構築するまでを案内します。内容は十分に明示的なので、このリポジトリの URL を
AI アシスタントに渡してセットアップを代行させることもできます（[AI に任せてインストールする](#ai-に任せてインストールする)
を参照）。

## 前提条件

- **Node.js >= 20.12**（サーバは組み込みの `--env-file` フラグを使用。テストスクリプトは
  20.12 で追加された `--env-file-if-exists` を使用します）。`node --version` で確認してください。
- **Intervals.icu アカウント**と **API key**：intervals.icu の *Settings → Developer* で
  API key をコピーします。
- **あなたの athlete ID**：自分のカレンダー/プロフィールを表示しているときに Intervals.icu の
  URL に表示されます（`i12345678` のような短い文字列）。athlete ID に `0` を指定することもでき、
  これは「この API key の所有者」を意味します。
- **（任意）Stryd エクステンション。** `get_current_pmc`、`get_weekly_summary`、
  `get_phase_summary`、`estimate_critical_impact` の各ツールは Stryd の負荷指標（LBSS / ILR）を
  使用します。これらには Stryd パワーメーター**と**、少数の Intervals.icu カスタムフィールド
  （最低限、LBSS フィールドと `StrydILR`）が必要です —
  [Stryd カスタムフィールドの設定](#stryd-カスタムフィールドの設定任意)を参照してください。
  （`estimate_critical_impact` は Stryd API を使わず、ストリーム + Critical Power から
  Stryd の Critical Impact を逆算します。）
  **コアツールは Stryd なしでも動作します** — エクステンションはパワーベースの PMC を上乗せするだけです。
- **（任意）天候メトリクス。** `search_similar_activities` が使用する `average_feels_like` の値は、
  Intervals.icu の Open-Meteo エンリッチメントに由来します。温度フィルタを設定すると、天候データの
  ないアクティビティは除外されます。

## MCPB でインストール（Claude Desktop・最も簡単）

Claude Desktop は単一の `.mcpb` バンドルからこのサーバをインストールできます——clone も
Node のセットアップも不要です。[最新リリース](https://github.com/methylone/Intervals-MCP-Server-with-STRYD/releases)
から `intervals-mcp-with-stryd.mcpb` をダウンロードしてダブルクリックすると、Claude Desktop が
3 項目の入力を求めます:

- **Athlete ID** — `i…`（または `0`、API キー所有者）。
- **API キー** — Intervals.icu の *Settings → Developer* から。sensitive 扱いで、平文ファイル
  ではなく **OS キーチェーン**に保管されます。
- **タイムゾーン** — IANA 名（任意・デフォルト `UTC`）。

**Stryd** ツールがデータを返すには、下記
[Stryd カスタムフィールドの設定](#stryd-カスタムフィールドの設定任意)が引き続き必要です。
サーバのインストール自体はこれ以外に何も要りません。

## npx でインストール

クライアントが MCP サーバをコマンドで起動する方式（Claude Desktop, Codex など）なら、公開
npm パッケージを直接実行できます——clone もビルドも不要:

```json
{
  "mcpServers": {
    "intervals-stryd": {
      "command": "npx",
      "args": ["-y", "intervals-mcp-with-stryd"],
      "env": {
        "INTERVALS_ATHLETE_ID": "i0000000",
        "INTERVALS_API_KEY": "your-api-key",
        "ATHLETE_TIMEZONE": "Asia/Tokyo",
        "CACHE_DIR": "/absolute/path/to/intervals-cache"
      }
    }
  }
}
```

`CACHE_DIR` は任意ですが、ここでは推奨です。ディスク上のストリームキャッシュはサーバの
インストール位置配下に解決されますが、`npx` ではそれが **揮発的な npx パッケージキャッシュ**に
なるため、実行をまたいでキャッシュを残したい場合は安定した絶対パスを `CACHE_DIR` に指定して
ください。（キャッシュ対象はアクティビティの *ストリーム* のみ。PMC / ウェルネス / アクティビティ
は常に新規取得です。）npm パッケージは `intervals-mcp` CLI も `PATH` に導入します——
[docs/CLI.md](docs/CLI.md) を参照。

Stryd 拡張には、下記
[Stryd カスタムフィールドの設定](#stryd-カスタムフィールドの設定任意)を追加してください。

> **0.10.0 以前からの更新時:** ツールの namespace が全インストール方式で
> **`intervals-stryd`** に統一されました（従来はコマンド設定が `intervals`、MCPB バンドルが
> `Intervals MCP with STRYD`）。コマンド設定のユーザーは `mcpServers` のキーを
> `intervals` → `intervals-stryd` にリネームしてください。MCPB のユーザーは更新後に自動で
> 新しい namespace が適用されます。旧 namespace でキーされたクライアント側メモリは引き継がれ
> ません（一度きりのリセットが発生します）。

## ソースからインストール（開発 / HTTP / Docker）

```bash
# 1. Clone
git clone https://github.com/methylone/Intervals-MCP-Server-with-STRYD.git intervals-mcp-server
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
- **`READ_ONLY`** — `false`（デフォルト）または `true`。`true` にするとカレンダー書き込み 4 ツール
  （`create_events` / `update_event` / `delete_event` / `delete_events`）を登録せず、サーバは
  Intervals.icu アカウントに書き込めなくなります。ローカル専用ツールは残ります。あくまでローカルの
  緩和策で、API キー自体は全アクセス権を持ちます。（MCPB 利用時は拡張設定の「Read-only mode」
  トグルを使用。）
- **`LBSS_FIELD`** / **`LBSS_FIELD_LEGACY`** / **`ILR_FIELD`** — Stryd 集計ツールが読み取る
  Intervals.icu のカスタムフィールドコード（CamelCase、アンダースコア不可）。デフォルトは
  `StrydLBSSv2` / `StrydLBSSmod` / `StrydILR`。再キャリブレーションや改名があってもコード変更が
  不要なように設定可能です。LBSS 系ツールは per-call の `lbss_field` 上書きも受け付け、
  `include_legacy=true` で `LBSS_FIELD_LEGACY` を併記します。
  **v0.6.0 で LBSS の既定が `StrydLBSSmod` → `StrydLBSSv2` に変更されました** — アカウントに
  コミュニティの `StrydLBSSmod` フィールドしかない場合は、
  [フィールド設定ガイド](<https://github.com/methylone/Intervals-MCP-Server-with-STRYD/wiki/Stryd-LBSS-v2-Field-Setup-(日本語)>)
  から `StrydLBSSv2` を作成するか、`LBSS_FIELD=StrydLBSSmod` を設定して以前の動作に戻してください。

### Stryd カスタムフィールドの設定（任意）

Stryd エクステンションは Intervals.icu の **カスタムアクティビティフィールド**を読み取ります。
これらはコミュニティ共有（または自作）のフィールドで、自分のアカウントに追加するものです —
組み込みではありません。最低限 **`StrydILR`** と 1 つの **LBSS フィールド**が必要で、残りは任意です。
追加するには:

1. Intervals.icu で **Settings → Sport Settings → RUN → CUSTOM FIELDS**（ボタン）を開くと、
   **Activity Fields** ダイアログが表示されます。ここで **ADD FIELD** から新規フィールドを作成するか、
   虫眼鏡付きの **FIELD** 検索からコミュニティ共有フィールドを追加できます。（フィールドの作成・編集時は
   **TYPE / DESCRIPTION / SCRIPT** の各タブで定義します。小数桁は「Decimals」ではなく **Format**
   （例: `.1f`）で設定します。）

2. 必要なフィールドを追加します。**`StrydILR` と LBSS フィールド 1 つが必須**、残りは任意です:

   | フィールドコード（本サーバが読み取る） | 必須? | 内容 / 入手方法 |
   |---|---|---|
   | `StrydLBSSv2` *または* `StrydLBSSmod` | **必須**（LBSS フィールド 1 つ） | Lower Body Stress Score — LBSS ベースの PMC が依拠します。`StrydLBSSv2` は Stryd に忠実な再キャリブレーション版で**コミュニティ検索には出ません**。[フィールド設定ガイド](<https://github.com/methylone/Intervals-MCP-Server-with-STRYD/wiki/Stryd-LBSS-v2-Field-Setup-(日本語)>)から作成してください。コミュニティの `StrydLBSSmod`（*miguell* 共有）は検索可能で、`LBSS_FIELD=StrydLBSSmod` を設定すれば使えます。 |
   | `StrydILR` | **必須** | Impact Loading Rate（衝撃負荷率）。コミュニティ共有（*Knuefi*）— **FIELD** 検索から追加します。 |
   | `StrydILRTreshold` | 任意 | ILR @ 閾値。コミュニティ共有（*miguell*）。**本サーバは消費しません**（アプリ内の ILR 表示に使われます）。コードは **`Treshold` の綴りを含めて**正確に一致させる必要があり、"ILR@CP Calculator" カスタムフィールドに依存します（そのフィールド自身の説明を参照）。 |
   | `EccLBSS` | 任意 | Eccentric（下り）LBSS。**本サーバは消費しません**。下り/偏心刺激を別途分析する場合に有用で、[フィールド設定ガイド](<https://github.com/methylone/Intervals-MCP-Server-with-STRYD/wiki/Stryd-LBSS-v2-Field-Setup-(日本語)>)で扱っています。 |

3. 追加すると、これらの値は**新しい Run アクティビティ**にコピーされるので、`get_current_pmc`、
   `get_weekly_summary`、`get_phase_summary`、および `get_activity_detail` /
   `search_similar_activities` の ILR フィールドにデータが入るようになります。

**過去のアクティビティについて。** 新しいアクティビティには自動でこれらのフィールドが付きます。
Stryd の LBSS/ILR データは概ね **2025 年 11 月**以降でのみ利用可能なので、それより古いアクティビティには
いずれにせよ付きません。その範囲内のアクティビティについては、Intervals.icu で再処理することで値を
バックフィルできます。

## クライアントの接続

クライアント設定では絶対パスを使用してください。`/absolute/path/to/intervals-mcp-server` を実際の
チェックアウトパスに置き換え、自分の認証情報を使用します。

### Claude Desktop — stdio（推奨）

`claude_desktop_config.json` を編集します
（macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`）:

```json
{
  "mcpServers": {
    "intervals-stryd": {
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

Claude Desktop を再起動すると、`intervals-stryd` のツールが表示されるはずです。

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
    "intervals-stryd": {
      "command": "npx",
      "args": ["mcp-remote", "http://<server-host-on-your-vpn>:8080/mcp", "--allow-http"]
    }
  }
}
```

サーバ上で 24/7 稼働させ続けるには、`systemd` のようなプロセスマネージャの下で実行します
（`node build/index.js` を `Environment=MCP_TRANSPORT=http` と、`.env` を指す `EnvironmentFile`
付きで実行する `simple` サービス）。または下記の Docker を使います。

### Docker で実行（HTTP モード）

`Dockerfile` と `docker-compose.yml` を同梱しています。コンテナは HTTP モードで動作するため、
SECURITY の注意はそのまま当てはまります — 信頼できるネットワーク内のみで動かし、公開インターネットに
直接さらさないでください。

```bash
cp .env.example .env        # API キー・athlete ID・タイムゾーンを記入
docker compose up -d --build
curl http://127.0.0.1:8080/health   # -> {"status":"ok",...}
```

イメージはマルチステージの Node 22 Alpine ビルドで、非 root ユーザで動作し、`/health` の
HEALTHCHECK を備え、本番依存とコンパイル済み `build/` のみを含みます。秘密情報は compose の
`env_file` 経由で `.env` から読み込まれ、ストリームキャッシュは名前付きボリューム
`intervals-cache` に保存されます。compose の `environment:` で `CACHE_DIR=/data/cache/streams`
を強制するため、`.env` にホスト向けの `CACHE_DIR` が入っていてもコンテナ内では安全に上書きされます。

compose を使わない場合:

```bash
docker build -t intervals-mcp .
docker run -d --name intervals-mcp -p 8080:8080 \
  --env-file .env -e MCP_TRANSPORT=http -e CACHE_DIR=/data/cache/streams \
  -v intervals-cache:/data/cache/streams intervals-mcp
```

クライアントへの橋渡し（例: `mcp-remote`）は上記 HTTP モードと同じ手順です。

## AI に任せてインストールする

このリポジトリは自己記述的なので、セットアップを委譲できます:

1. AI アシスタント（Claude / Codex）にこのリポジトリの URL を渡し、`README.md`、この `INSTALL.md`、
   `ARCHITECTURE.md` を読むよう依頼します。
2. clone・`npm install`・`.env.example` からの `.env` 作成・`npm run build` を依頼します。API key と
   athlete ID は尋ねられたら渡します（自分が管理していない、共有・ログ記録されるチャットに秘密情報を
   貼り付けないこと）。
3. お使いのクライアント（Claude Desktop / Codex）向けに、絶対パスを埋めたクライアント設定ブロックを
   出力するよう依頼します。
