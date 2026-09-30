---
title: API と HTTP リファレンス
description: RemoteFileGateway のメソッド、プロバイダーバインディング、HTTP 範囲規則、エラー報告を説明します。
---

# API と HTTP リファレンス

## JavaScript API

ページ側ではパッケージのルートから `RemoteFileGateway` と `RemoteFileGatewayError` を読み込みます。既存の module Service Worker では `service-worker-handler` サブパスから `createRemoteFileGatewayHandler` を読み込みます。

```js
import {
  RemoteFileGateway,
  RemoteFileGatewayError,
} from 'browser-remote-file-gateway'

import {
  createRemoteFileGatewayHandler,
} from 'browser-remote-file-gateway/service-worker-handler'
```

| API | 説明 |
|---|---|
| `RemoteFileGateway.register(options)` | 単独 module Service Worker を登録し、ページの制御を待ち、プロトコルをネゴシエートしてキャッシュ上限を設定します。 |
| `RemoteFileGateway.initialize(options)` | `register(options)` のエイリアスです。 |
| `RemoteFileGateway.connect({ registration, virtualBase, ... })` | 既存の Service Worker 登録にページ側コントローラーを接続します。ハンドラーのインストールとルーティングはホストが行います。 |
| `gateway.registration` / `gateway.scope` | 関連付けられた登録とスコープパスを返します。 |
| `gateway.virtualUri(objectId)` | 公開済みのオブジェクト ID に対応する同一オリジンの絶対 URL を返します。 |
| `gateway.publishBindings(revision, bindings)` | プロバイダーのバインディング一式をアトミックに置き換えます。`revision` は 0 以上の `bigint` です。 |
| `gateway.setCredential(provider, credential)` | Service Worker のメモリ内にプロバイダー認証情報を設定します。現在、認証が必要なプロバイダーは `google-drive` です。 |
| `gateway.clearCredential(provider)` | 登録を使うクライアント間で共有されるプロバイダー認証情報を消去します。 |
| `gateway.configureCache(maxFullObjectCacheBytes)` | OPFS キャッシュ対象にできる個々のオブジェクトの最大サイズを設定します。`0` で無効になります。 |
| `gateway.diagnostics()` / `gateway.resetDiagnostics()` | メモリ内にある上限付きの診断記録を取得または初期化します。 |
| `gateway.close()` | このコントローラーインスタンスと `controllerchange` リスナーを解放します。 |
| `createRemoteFileGatewayHandler({ virtualBase })` | ホストの module Service Worker 向けに、リスナー非登録型ハンドラーを作成します。 |

コントローラーの制御メソッドは、操作に失敗すると `.code` に機械可読なコードを持つ `RemoteFileGatewayError` を返します。`close()` は複数回呼び出せます。

### バインディング項目

すべてのバインディングには `objectId`、`provider`、`bytes`、`contentVersion` が必要です。`mimeType` は省略可能で、既定値は `application/octet-stream` です。オブジェクト ID は `[a-z0-9][a-z0-9-]{0,127}` に一致し、バイト長は正の安全な整数でなければなりません。

| プロバイダー | 必須のプロバイダー項目 | 不変な ID 項目 |
|---|---|---|
| `http-range` | `locator` — HTTP(S) URL | provider、bytes、`contentVersion` |
| `google-drive` | `fileId` — Drive ファイル ID | provider、bytes、MD5 `contentVersion`、`fileId` |

Google Drive の `apiBase` は省略可能で、既定値は `https://www.googleapis.com/` です。`contentVersion` には 32 文字の小文字 16 進 MD5 チェックサムを指定します。`mimeType` は HTTP レスポンスヘッダーだけに影響します。

`publishBindings()` は現在有効な一式を置き換えます。リビジョンを増加させるか、内容が同じ場合に限り現在のリビジョンを再利用できます。同じオブジェクト ID に異なる不変項目は設定できません。HTTP の `locator` と `mimeType` は ID を変えずに更新できます。

### 認証情報の形式

```js
{
  accessToken: '…',
  generation: 'token-refresh-18',
  expiresAt: Date.now() + 45 * 60 * 1000,
}
```

`accessToken` は 8〜4096 文字です。`generation` は英数字、`_`、`-` を使った 1〜64 文字の識別子です。`expiresAt` はミリ秒単位のエポック時刻を表す安全な整数です。トークンは Service Worker のメモリ内にのみ保存され、同じ登録を使うクライアント間で共有されます。ホストアプリケーションのログアウト時に明示的に消去してください。

## HTTP コントラクト

仮想 URI は拡張子を持たず、次の形式です。

```text
<virtualBase>objects/<objectId>
```

既定の `virtualBase` は `/remote-file-gateway/` です。

| リクエスト | 結果 |
|---|---|
| `Range` なしの `HEAD` | オブジェクト全体の長さとバイト範囲ヘッダーを含む `200`。 |
| 有効な単一 `Range` 付き `HEAD` | 選択範囲のメタデータを含む `206`。レスポンス本文はありません。 |
| 有効な単一 `Range` 付き `GET` | 要求したバイトを含む `206`。 |
| `Range` なしの `GET` | `400`（`RC_RANGE_REQUIRED`）。 |
| 未対応のメソッド | `405`（`RC_METHOD_NOT_ALLOWED`）、`Allow: GET, HEAD`。 |
| 不正、suffix、複数範囲 | `416`（`RC_RANGE_NOT_SATISFIABLE`）と `Content-Range: bytes */<size>`。 |

対応する範囲は `bytes=<start>-<end>` または `bytes=<start>-` です。終端はオブジェクトの末尾に制限されます。suffix と複数範囲は未対応です。完全オブジェクトが OPFS から返される場合を除き、リモートプロバイダーは範囲レスポンスに対応する必要があります。

Gateway が生成するすべてのエラーレスポンスには `X-Remote-File-Gateway-Error-Code` が含まれます。設定した仮想ベース外のリクエストと `REMOTE_FILE_GATEWAY_` 名前空間外のメッセージはハンドラーで処理されません。

## 主なエラーコード

`RC_AUTHENTICATION_REQUIRED`、`RC_AUTHORIZATION_DENIED`、`RC_OBJECT_NOT_FOUND`、`RC_CONTENT_REVISION_CHANGED`、`RC_RANGE_REQUIRED`、`RC_RANGE_NOT_SATISFIABLE`、`RC_RANGE_UNSUPPORTED`、`RC_CACHE_BODY_INVALID`、`RC_REMOTE_FETCH_FAILED` などがあります。HTTP リクエストではレスポンスヘッダー、コントローラーエラーでは `.code` を使って判定してください。人間向けメッセージの文字列には依存しないでください。

## 実行環境と制限

- Service Worker は HTTPS または localhost などのセキュアコンテキストで動作します。
- プロバイダーへのリクエストは Service Worker から送信され、プロバイダーの CORS と認証要件に従います。
- Google Drive の認証情報は RAM に保持され、バインディングは IndexedDB に永続化されます。
- OPFS は任意です。キャッシュ上限は個々のオブジェクトに適用され、合計ストレージ量は制限しません。
- Gateway は Dedicated Worker を作成せず、ファイルを解析せず、OPFS を使わない範囲読み取りのコンテンツハッシュも保証しません。
- API は実験段階で、今後変更される可能性があります。

利用例と詳細な動作については、[クイックスタート](./getting-started.md)、[プロバイダー](./providers.md)、[キャッシュ](./cache.md)を参照してください。
