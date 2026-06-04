[English](README.md) | 日本語

# Intervals.icu MCP Server

AIクライアント（Claude Desktop, Codex など）に、あなたの [Intervals.icu](https://intervals.icu)
トレーニングデータへの構造化されたアクセスを提供する Model Context Protocol (MCP) サーバです。
あわせて、AI に推測させるべきでない決定的な計算（Performance Management Chart の値、
心拍デカップリング、派生栄養フィールドなど）をサーバ側で行います。

**ローカルで、単一アスリート（あなた）向け**に動かす想定です。ホスティングされた
マルチユーザ向けサービスではありません。

## できること

- **コア（すべての Intervals.icu ユーザ向け）**：アクティビティ、ウェルネスデータ、
  イベント／計画ワークアウト（取得＋作成・更新・削除）、アスリートサマリー、
  ストリーム単位の分析（スプリット、心拍デカップリング、ペース）の取得・確認。
- **Stryd 拡張（パワーメーター利用者向け）**：下肢負荷指標（LBSS）から EMA で
  サーバ側計算する第二の Performance Management Chart を、Intervals.icu 内蔵の
  RSS ベース PMC と並べて提供。週次・フェーズ単位の負荷トレンドも。

このサーバが提供するのは **データと計算だけ**です。どうトレーニングすべきかは
**決めません**——その解釈は、あなた自身が書いて AI クライアントに読み込ませる
「ナレッジ」ファイルから来ます。[`training-knowledge-template/`](training-knowledge-template/) を参照。

## クイックスタート

前提：Node.js ≥ 20.12、Intervals.icu アカウントと API キー。Stryd 拡張を使う場合は
Stryd パワーメーターと、対応する Intervals.icu のカスタムフィールドが追加で必要です。
詳細は [INSTALL.ja.md](INSTALL.ja.md)。

```bash
git clone <repo-url>
cd intervals-mcp-server
npm install
cp .env.example .env      # API キー・athlete ID・タイムゾーンを記入
npm run build
```

その後、Claude Desktop（または Codex）を stdio 経由で `build/index.js` に向けます——
正確な設定ブロックは [INSTALL.ja.md](INSTALL.ja.md) を参照。初めてですか？ リポジトリの URL を
AI クライアントに渡し、README と INSTALL を読ませてインストールを案内させることもできます。

## ドキュメント

- [INSTALL.ja.md](INSTALL.ja.md) — 前提条件とクライアント設定
- [ARCHITECTURE.md](ARCHITECTURE.md) — コード構成と拡張方法（英語）
- [SECURITY.ja.md](SECURITY.ja.md) — **HTTP モードを使う前に必読**
- [`training-knowledge-template/`](training-knowledge-template/) — AI クライアント用の
  分析ナレッジを自分で作るためのテンプレート

## セキュリティ

HTTP トランスポートには **アプリケーション層の認証がありません**。個人利用では
stdio でローカルに動かし、HTTP モードを公開インターネットに晒さないでください。
[SECURITY.ja.md](SECURITY.ja.md) を参照。

## コントリビューション

フォーク歓迎です——自由に持っていって、あなたのものにしてください。プルリクエストは
積極的にメンテナンスしていないため、タイムリーなレビューを期待せず、自由にフォークして
ください。

## ライセンス

[AGPL-3.0-or-later](LICENSE)。要点：使用・改変・実行は自由（商用も可）ですが、
配布する場合や、改変版をネットワークサービスとして運用する場合は、同じライセンスで
ソースを公開する必要があります。クローズドな独占製品にすることはできません。
