---
title: プロバイダー
description: Google Drive と HTTP Range のバインディングを設定し、認証情報を仮想 URL から分離します。
---

# プロバイダー

バインディングは、Service Worker がオブジェクト ID をどのように解決するかを定義します。現在の実装は `google-drive` と `http-range` に対応しています。どちらもファイル形式や DuckDB には依存しません。

## HTTP Range

バイト範囲リクエストに対応し、要求範囲の長さに一致する `206 Partial Content` を返す URL には `http-range` を使います。

```js
{
  objectId: 'report-v3',
  provider: 'http-range',
  locator: 'https://storage.example.test/report.csv?signature=…',
  bytes: 12_400,
  contentVersion: 'report-v3-sha256-4c5a',
  mimeType: 'text/csv',
}
```

ロケーターには HTTP または HTTPS の URL を指定できます。ロケーターはプロバイダーのバインディングと一緒に IndexedDB に保存されますが、仮想 URI には含まれません。保存を許容できる場合を除き、認証情報をロケーターに含めないでください。プロバイダーが対応する場合はプロバイダー認証を使います。プロバイダー、バイト長、コンテンツバージョンが同じなら、ロケーターを更新してもオブジェクト ID は変わりません。

キャッシュ対象外の読み取りでは、Gateway は要求範囲を転送し、プロバイダーが `206` を返すことを要求します。要求範囲の長さと一致しないレスポンスは拒否します。設定した上限以下のオブジェクトをキャッシュする場合、最初に範囲指定なしの完全取得を行うことがあります。詳細は[キャッシュ](./cache.md)を参照してください。

## Google Drive

Google Drive のバインディングでは、ファイル ID、バイト長、ファイルの MD5 チェックサムを `contentVersion` に指定します。

```js
await gateway.setCredential('google-drive', {
  accessToken,
  generation: 'oauth-refresh-17',
  expiresAt: Date.now() + 45 * 60 * 1000,
})

await gateway.publishBindings(1n, [
  {
    objectId: 'drive-report-v3',
    provider: 'google-drive',
    fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    bytes: 12_400,
    contentVersion: '0123456789abcdef0123456789abcdef',
    mimeType: 'text/csv',
  },
])
```

OAuth トークンの取得と更新はアプリケーションが行います。`generation` は特定の認証情報の世代を表します。トークンを交換したときは値を変え、以前の認証情報で解決したメタデータが再利用されないようにします。`expiresAt` はミリ秒単位のエポック時刻です。トークンは Service Worker のメモリ内だけに保持され、IndexedDB には保存されません。

オブジェクトを返す前に、Gateway は Google Drive のメタデータと公開済みのファイル ID、サイズ、MD5 チェックサム、ダウンロード権限を照合します。内容のバージョンまたは権限が変わった場合、古いオブジェクト ID のままデータを返すのではなく、リクエストを失敗させます。OPFS から返さない場合、Google Drive のメディア取得はバイト範囲リクエストになります。

ログアウト時は、登録内で共有される認証情報を明示的に消去してください。

```js
await gateway.clearCredential('google-drive')
```

## プロバイダーエラー

認証、認可、オブジェクト不在などのエラーは、`X-Remote-File-Gateway-Error-Code` を含む HTTP エラーとして返されます。コントローラーの制御メソッドは `.code` プロパティを持つ `RemoteFileGatewayError` を返します。レスポンスのステータスとコードを使って、認証情報の更新、バインディングの変更、エラー表示などを判断してください。
