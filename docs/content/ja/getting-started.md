---
title: クイックスタート
description: Gateway の Service Worker を登録し、HTTP Range バインディングを公開して仮想オブジェクトを読み取ります。
---

# クイックスタート

このガイドでは、HTTP Range プロバイダーのオブジェクトを公開し、Gateway 経由で先頭 1 KiB を読み取ります。HTTPS または localhost でページを配信してください。Service Worker と OPFS はセキュアコンテキストでのみ利用できます。

## 1. Gateway モジュールを配信する

リポジトリのルートで `pnpm build` を実行します。コントローラーモジュールをアプリケーションから利用できるようにし、ビルドされた `dist/service-worker.js` と `dist/service-worker-handler.js` を同一オリジンから配信します。以下では `/remote-file-gateway/` を配置先として使います。

```text
/remote-file-gateway/service-worker.js
/remote-file-gateway/service-worker-handler.js
```

ビルドされた `dist/service-worker.js` は `./service-worker-handler.js` を読み込み、Service Worker のライフサイクルを管理します。コピーの際は、2 つのファイルを同じ場所に置いてください。コントローラーはパッケージのルートから読み込むか、アプリケーションにバンドルできます。以下では、このリポジトリのパッケージ名を使います。ローカルワークスペースやインストール方法に合わせて調整してください。

## 2. Gateway を登録する

```js
import { RemoteFileGateway } from 'browser-remote-file-gateway'

const gateway = await RemoteFileGateway.register({
  serviceWorkerUrl: '/remote-file-gateway/service-worker.js',
  scope: '/',
  virtualBase: '/remote-file-gateway/',
})
```

`register()` は module Service Worker を登録し、その Service Worker がページを制御するまで待機してから、互換性のあるプロトコルをネゴシエートします。既定の `controlTimeoutMs`（20 秒）までに想定した登録がページを制御しない場合、呼び出しは失敗します。

この例では、サブディレクトリにある Service Worker にルートスコープを指定しています。このようにスクリプトの配置場所より広いスコープを許可するには、スクリプトのレスポンスに `Service-Worker-Allowed: /` ヘッダーが必要です。ホスト側で設定できない場合は、スクリプトをオリジンのルートに置くか、スクリプトのディレクトリとページの両方を含むスコープを指定してください。ビルド済みの単独 Worker は、配置先のディレクトリを仮想ベースとして使います。`virtualBase` も同じパスにしてください。

## 3. バインディングを公開する

公開のたびに、現在有効なバインディング一式を置き換えます。リビジョンには 0 以上の `bigint` を指定し、以前の値より小さくできません。オブジェクト ID は、コンテンツハッシュやバージョン名など、アプリケーションが選ぶ安定した識別子です。

```js
await gateway.publishBindings(1n, [
  {
    objectId: 'events-v1',
    provider: 'http-range',
    locator: 'https://data.example.test/events.csv',
    bytes: 18_432,
    contentVersion: 'events-sha256-9f21',
    mimeType: 'text/csv',
  },
])
```

信頼できるメタデータから、オブジェクト長とコンテンツバージョンを指定してください。Gateway は範囲レスポンスが要求範囲に対応し、想定した長さであることを確認します。キャッシュ対象外の範囲読み取りについて、コンテンツ全体のハッシュを計算するわけではありません。

## 4. 仮想オブジェクトを読み取る

```js
const url = gateway.virtualUri('events-v1')
const response = await fetch(url, {
  headers: { Range: 'bytes=0-1023' },
})

if (!response.ok) {
  const code = response.headers.get('X-Remote-File-Gateway-Error-Code')
  throw new Error(`Gateway request failed (${code ?? response.status})`)
}

console.log(response.status) // 206
const firstKiB = await response.arrayBuffer()
```

利用側はメインスレッドでも Dedicated Worker 内でも動作できます。仮想 URL に対して `HEAD` または単一範囲の `GET` を使用します。`Range` を付けない `GET` は拒否されます。

## 5. コントローラーを閉じる

```js
// Google Drive を使った場合は、閉じる前に共有トークンを消去します。
await gateway.clearCredential('google-drive')
await gateway.close()
```

閉じると、このコントローラーインスタンスの `controllerchange` リスナーが解除されます。同じ Service Worker 登録を使うクライアントと共有している認証情報は削除されません。Google Drive を使った場合は、ログアウト時に `close()` より先に `clearCredential()` を呼び出してください。閉じたコントローラーから制御操作は行えません。

## 既存 Service Worker を使う

既存の module Service Worker がある場合は、パッケージの `service-worker-handler` サブパスからリスナー非登録型ハンドラーを読み込み、一致するイベントをフォールバック処理より先に渡します。

```js
import { createRemoteFileGatewayHandler } from 'browser-remote-file-gateway/service-worker-handler'

const gatewayHandler = createRemoteFileGatewayHandler({
  virtualBase: '/remote-file-gateway/',
})

self.addEventListener('fetch', (event) => {
  if (gatewayHandler.handleFetch(event)) return
  // ホストアプリケーションの fetch ハンドラーへ続けます。
})

self.addEventListener('message', (event) => {
  if (gatewayHandler.handleMessage(event)) return
  // ホストアプリケーションの message ハンドラーへ続けます。
})
```

ページ側のコントローラーは、有効な登録に接続します。

```js
const gateway = await RemoteFileGateway.connect({
  registration: await navigator.serviceWorker.ready,
  virtualBase: '/remote-file-gateway/',
})
```

このモードでは、インストール、アクティベーション、`skipWaiting()`、`clients.claim()` をホストが管理します。コントローラー、ハンドラー、ホストアプリケーションの責務については[基本概念](./concepts.md)を参照してください。
