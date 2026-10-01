---
title: Remote File Gateway
description: Publish immutable same-origin HTTP resources backed by Google Drive or HTTP Range providers.
---

# Remote File Gateway

Remote File Gateway gives browser applications a stable, same-origin URL for a remote object. A Service Worker resolves that URL to a configured provider and serves byte ranges on demand. The application can then use ordinary `HEAD` and `Range` `GET` requests without putting provider URLs or credentials in the consumer-facing URI.

```text
/remote-file-gateway/objects/<object-id>
```

The Gateway is a small HTTP transport layer. It does not create consumer workers, parse file formats, depend on DuckDB, or publish catalog metadata. The host application owns object selection, provider credentials, and the lifetime of any consumer workers.

## What it provides

- Stable virtual URIs for immutable object identities.
- Range reads through Google Drive or an HTTP endpoint that supports byte ranges.
- A standalone Service Worker for quick setup, or a listener-free handler for an existing module Service Worker.
- An optional bounded OPFS cache for complete objects below a size threshold.
- Structured diagnostics and machine-readable HTTP error codes.

## Start here

- [Quickstart](./getting-started.md) — register the Service Worker, publish a binding, and request a byte range.
- [Concepts](./concepts.md) — understand the Gateway boundary, object identity, and Service Worker modes.
- [Providers](./providers.md) — configure Google Drive and HTTP Range sources.
- [Cache](./cache.md) — choose a full-object cache limit and understand fallback behavior.
- [API and HTTP reference](./reference.md) — controller methods, binding fields, request rules, and errors.

The project is experimental and its API may evolve. The repository currently provides source modules; applications should bundle or serve those modules from their own same-origin deployment.
