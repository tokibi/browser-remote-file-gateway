---
title: Remote File Gateway
description: Google Drive または HTTP Range プロバイダーを、同一オリジンの不変な HTTP リソースとして公開します。
---

# Remote File Gateway

Remote File Gateway は、リモートオブジェクトに安定した同一オリジンの URL を提供します。Service Worker がその URL を設定済みプロバイダーに解決し、必要なバイト範囲を返します。利用側はプロバイダーの URL や認証情報を仮想 URI に含めず、通常の `HEAD` と `Range` 付き `GET` を使えます。

```text
/remote-file-gateway/objects/<object-id>
```

Gateway は小さな HTTP 転送レイヤーです。利用側の Worker を作成せず、ファイル形式を解析せず、DuckDB に依存せず、カタログのメタデータも公開しません。公開するオブジェクト、プロバイダー認証情報、利用側 Worker のライフサイクルはホストアプリケーションが管理します。

## 提供する機能

- 不変なオブジェクト ID に対応する安定した仮想 URI
- Google Drive またはバイト範囲リクエストに対応した HTTP エンドポイントからの読み取り
- 手軽に使える単独 Service Worker、または既存の module Service Worker に組み込めるリスナー非登録型ハンドラー
- サイズ上限付きの任意 OPFS キャッシュ
- 構造化診断情報と機械可読な HTTP エラーコード

## はじめに

- [クイックスタート](./getting-started.md) — Service Worker の登録、バインディングの公開、バイト範囲の取得
- [基本概念](./concepts.md) — Gateway の責務、オブジェクト ID、Service Worker のモード
- [プロバイダー](./providers.md) — Google Drive と HTTP Range ソースの設定
- [キャッシュ](./cache.md) — 完全オブジェクトのキャッシュ上限とフォールバック動作
- [API と HTTP リファレンス](./reference.md) — コントローラーのメソッド、バインディング項目、リクエスト規則、エラー

このプロジェクトは実験段階で、API は今後変更される可能性があります。現在、リポジトリにはソースモジュールが含まれています。アプリケーションでは、モジュールをバンドルするか、同一オリジンから配信してください。
