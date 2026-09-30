---
title: Providers
description: Configure Google Drive and HTTP Range bindings and keep credentials out of virtual URLs.
---

# Providers

Bindings describe how the Service Worker resolves an object ID. The current implementation supports `google-drive` and `http-range`. Both are independent of file format and DuckDB.

## HTTP Range

Use `http-range` when the source URL supports byte-range requests and returns a bounded `206 Partial Content` response with the expected number of bytes.

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

The locator may be an HTTP or HTTPS URL. It is stored in IndexedDB with the provider binding and is never included in the virtual URI. Do not put credentials in the locator unless your application accepts them being persisted there; use provider authorization when the provider supports it. Rotating a locator does not change object identity as long as provider, byte length, and content version stay the same.

For uncached reads, the Gateway forwards the requested range and requires the provider to return `206`. It rejects a response that does not match the requested range length. A full-object cache fill may make one non-range request for an object that is within the configured cache limit; see [Cache](./cache.md).

## Google Drive

Google Drive bindings use a file ID, a byte length, and the file's MD5 checksum as `contentVersion`:

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

The application obtains and refreshes the OAuth token. `generation` identifies a particular credential generation; change it when replacing a token so the Gateway does not reuse metadata resolved under the previous credential. `expiresAt` is an epoch timestamp in milliseconds. The token stays in Service Worker memory and is not persisted in IndexedDB.

Before serving an object, the Gateway checks Google Drive metadata against the published file ID, size, MD5 checksum, and download capability. If the content revision or permissions changed, the request fails rather than serving bytes under the old object identity. Google Drive media requests are range reads when the object is not served from OPFS.

During logout, clear the registration-shared credential explicitly:

```js
await gateway.clearCredential('google-drive')
```

## Provider errors

Provider authentication, authorization, and missing-object failures are returned as HTTP errors with a code in `X-Remote-File-Gateway-Error-Code`. The controller methods surface control-plane errors as `RemoteFileGatewayError` objects with a `.code` property. Use the response status and code to decide whether to refresh credentials, update a binding, or report a provider failure.
