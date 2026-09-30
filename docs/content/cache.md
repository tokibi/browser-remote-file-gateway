---
title: Cache
description: Configure the optional bounded OPFS full-object cache and understand range fallback.
---

# Optional OPFS cache

The Gateway can cache complete objects in Origin Private File System (OPFS). It caches only an object whose full size is at or below the configured `maxFullObjectCacheBytes`. The default is `0`, which disables caching.

Set the limit at registration time or update it on an active controller:

```js
const gateway = await RemoteFileGateway.register({
  serviceWorkerUrl: '/remote-file-gateway/service-worker.js',
  scope: '/',
  virtualBase: '/remote-file-gateway/',
  maxFullObjectCacheBytes: 4 * 1024 * 1024,
})

// Later, if application policy changes:
await gateway.configureCache(8 * 1024 * 1024)
```

The threshold is a per-Service-Worker-handler policy shared by clients connected to that handler. Choose it according to your application's storage budget and data sensitivity. The Gateway does not evict older objects to enforce an aggregate quota: the setting bounds which individual objects can be cached, not total OPFS usage.

## Read and fill behavior

For an object within the threshold, the first request attempts to fetch the complete provider response, checks its declared and actual length against the binding, computes a SHA-256 digest, and stores the object plus metadata in OPFS and IndexedDB. Later cache hits validate the committed metadata and integrity, then read only the requested `File.slice()` for a range request.

An object larger than the threshold bypasses OPFS and is served from the provider's bounded range response. If OPFS is unavailable, a cache write fails, or a cached entry is stale or corrupt, the Gateway records a diagnostic and falls back to the provider range path. Cache failure does not make OPFS a requirement for normal range reads.

The cache key is the object ID. Preserve the immutability rule: publish changed content under a new object ID instead of reusing an ID with a new content version. A later binding publication invalidates the in-memory resolved-object and cache-version checks; persisted cache entries that do not match the current object metadata are rejected.

## Diagnostics

`gateway.diagnostics()` returns bounded recent records for cache hits, misses, writes, bypasses, rejections, provider requests, virtual requests, and failures. Use `gateway.resetDiagnostics()` before a measurement window. Diagnostics are held by the Service Worker handler, so clients sharing a registration observe the same diagnostic stream.

See [Providers](./providers.md) for provider-specific behavior and [API and HTTP reference](./reference.md) for method signatures.
