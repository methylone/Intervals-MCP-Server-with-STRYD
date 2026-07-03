[English](README.md) | 日本語

# Intervals.icu MCP Server — Stryd ランナーのための

一言でいうと: Claude のような AI アシスタントにあなたの Intervals.icu のデータを読ませ、
トレーニング分析の相棒にするための部品です。数値の計算はすべてテスト済みのコードが行い、
AI には推測させません。

![Dual PMC チャート: 上段が RSS ベースの Fitness/Fatigue/Form、下段が Stryd LBSS ベースの負荷](docs/images/dual_pmc.jpg)

*上: パワー（RSS）ベースの PMC。下: 着地衝撃（LBSS）ベースの PMC——同じ選手の、異なる2種類の負荷を並べて追跡。*

**Stryd ランナー**のための [Intervals.icu](https://intervals.icu) MCP（Model Context
Protocol）サーバです。LLM に計算させない設計の、ランニングパワー特化トレーニング分析
（RSS、LBSS による dual PMC 対応）を提供します。決定的な数値（PMC の値、
心拍デカップリング、ramp rate）はサーバ側で計算し、AI クライアント（Claude Desktop,
Codex など）には**解釈だけ**を任せます——推測させません。

**ローカルで、単一アスリート（あなた）向け**に動かす想定です。ホスティングされた
マルチユーザ向けサービスではありません。

## できること

- **Stryd 拡張（これが存在する理由）。** 下肢負荷指標 **LBSS**（Lower Body Stress Score）
  から EMA でサーバ側計算する第二の Performance Management Chart を、Intervals.icu 内蔵の
  RSS ベース PMC と並べて提供します。**dual PMC**（筋骨格系負荷 *と* 代謝負荷）、ILR
  （Impact Loading Rate）トレンド、ウルトラマラソン志向のレビューに向けた週次・フェーズ
  単位のサマリーが得られます。LBSS / ILR のカスタムフィールド名は設定可能
  （`LBSS_FIELD` / `ILR_FIELD`、既定 `StrydLBSSv2` / `StrydILR`）で、較正し直した／改名した
  フィールドでもコード変更なしに対応できます。詳細は
  [INSTALL.md](INSTALL.md#setting-up-the-stryd-custom-fields-optional) と
  [フィールドレシピ](https://github.com/methylone/Intervals-MCP-Server-with-STRYD/wiki/LLM-Agent-Recipes)
  を参照。`estimate_critical_impact` は Stryd API を使わず、Intervals のストリームと Critical Power
  から Stryd の Critical Impact を逆算するので、LBSS の較正がサーバ内で完結します。
- **コア（すべての Intervals.icu ユーザ向け）。** アクティビティ、ウェルネス、HRV トレンド、
  イベント／計画ワークアウト（取得＋作成・更新・削除）、アスリートサマリー、ストリーム
  単位の分析（スプリット、心拍デカップリング、勾配補正ペース、カスタムパワー/HR ゾーン）。

このサーバが提供するのは **データと計算だけ**です。どうトレーニングすべきかは**決めません**
——その解釈は、あなた自身が書いて AI クライアントに読み込ませる「ナレッジ」ファイルから
来ます。[`training-knowledge-template/`](training-knowledge-template/) を参照。

## レースレポート

このツールがどう生まれ、奈良 100km ウルトラマラソンでどうテストされたかについて、レース
レポートも書きました:

[このツールを作ってから奈良 100km ウルトラマラソンでテストするまで](https://note.com/methylone/n/n6bc221063fe3)

## クイックスタート

迷ったら、このリポジトリの URL を Claude（またはお好みの AI アシスタント）に貼って
「セットアップを手伝って」と頼むこともできます——2 ステップの手順は
[AI に任せてインストールする](INSTALL.ja.md#ai-に任せてインストールする) を参照。

クライアントに合うインストール経路を選んでください。詳細・前提条件は
[INSTALL.ja.md](INSTALL.ja.md)。

### 1. MCPB バンドル — Claude Desktop（最も簡単）

[最新リリース](https://github.com/methylone/Intervals-MCP-Server-with-STRYD/releases)
から `.mcpb` バンドルをダウンロードし、ダブルクリックで Claude Desktop にインストール、
尋ねられる 3 項目（Athlete ID、API キー、タイムゾーン）を入力します。API キーは平文ファイル
ではなく **OS キーチェーン**に保管されます。

### 2. npx — 設定一行（Claude Desktop / Codex / 任意の MCP クライアント）

clone もビルドも不要。公開 npm パッケージにクライアントを向けるだけです:

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

`CACHE_DIR` は任意ですが npx では推奨です。指定しないとストリームキャッシュが npx の
揮発的なパッケージキャッシュに置かれます。[INSTALL.ja.md](INSTALL.ja.md#npx-でインストール)
を参照。

### 3. ソースから / Docker（開発・HTTP モード）

```bash
git clone https://github.com/methylone/Intervals-MCP-Server-with-STRYD.git
cd Intervals-MCP-Server-with-STRYD
npm install
cp .env.example .env      # API キー・athlete ID・タイムゾーンを記入
npm run build
```

その後、stdio 経由で `build/index.js` にクライアントを向けるか、HTTP / Docker で動かします
——[INSTALL.ja.md](INSTALL.ja.md) を参照。初めてですか？ リポジトリの URL を AI クライアントに
渡し、README と INSTALL を読ませてインストールを案内させることもできます。

## まず試してみる

インストール後は、ナレッジファイルも Stryd のカスタムフィールドも用意せずに、すぐに質問
できます。たとえばこんな聞き方ができます:

- 「今週のトレーニングをまとめて」
- 「今日の PMC は？ フォームの傾向も教えて」
- 「昨日のランのスプリットと心拍デカップリングを見せて」

一例:

> **あなた:** 今日の PMC は？
>
> **Claude:** Fitness(CTL)は 50、Fatigue(ATL)は 40 なので Form(TSB)は +10——フレッシュな
> 状態です。この3週間は Fitness が着実に上昇する一方 Fatigue は横ばいなので、今の負荷の
> 上げ方はスパイクというより持続可能なペースに見えます。

自分のトレーニング哲学を反映した、より踏み込んだコーチングが欲しくなったら →
[`training-knowledge-template/`](training-knowledge-template/) で AI クライアントに自分の
好みのトレーニング方針を教え込めます。

## コマンドラインでの利用

同じツール群は、`intervals-mcp` CLI を使ってシェルからも実行できます（MCP クライアント不要、
LLM 不要）——自動化、`jq` へのパイプ、簡単な確認に便利です。返すのは生データのみで、方法論は
**適用しません**。[docs/CLI.md](docs/CLI.md) を参照。

## ドキュメント

- [INSTALL.ja.md](INSTALL.ja.md) — 前提条件とクライアント設定（MCPB / npx / ソース）
- [docs/CLI.md](docs/CLI.md) — シェルからツールを実行する（英語）
- [ARCHITECTURE.md](ARCHITECTURE.md) — コード構成と拡張方法（英語）
- [SECURITY.ja.md](SECURITY.ja.md) — **セキュリティとプライバシーモデル**: 通信先・
  読み書きの範囲・キーとキャッシュの保管場所・HTTP モード
- [ROADMAP.md](ROADMAP.md) — 今後の予定
- [BACKGROUND.ja.md](BACKGROUND.ja.md) — なぜ作ったか・設計思想の短い読み物
- [`training-knowledge-template/`](training-knowledge-template/) — AI クライアント用の
  分析ナレッジを自分で作るためのテンプレート

## セキュリティとプライバシー

通信先は **1 つ**（intervals.icu）のみ、書き込めるのは **Intervals.icu のカレンダー
イベントだけ**、API キーはログに出さず、**テレメトリは送りません**。HTTP トランスポートには
**アプリケーション層の認証がありません** — 個人利用では stdio（または MCPB / npx）でローカルに
動かし、HTTP モードを公開インターネットに晒さないでください。キャッシュの中身・キーの影響範囲・
ビルド検証・アンインストールなどの詳細は [SECURITY.ja.md](SECURITY.ja.md) を参照。

## コントリビューション

フォーク歓迎です——自由に持っていって、あなたのものにしてください。プルリクエストは積極的に
メンテナンスしていないため、タイムリーなレビューを期待せず、自由にフォークしてください。

## ライセンス

[AGPL-3.0-or-later](LICENSE)。要点：使用・改変・実行は自由（商用も可）ですが、配布する場合や、
改変版をネットワークサービスとして運用する場合は、同じライセンスでソースを公開する必要があります。
クローズドな独占製品にすることはできません。
