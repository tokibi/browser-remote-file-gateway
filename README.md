# Browser Remote File Gateway

Expose remote provider objects as immutable, same-origin HTTP Range resources through a Service Worker.

This repository contains the standalone **Remote File Gateway** component extracted from `tokibi/duckdb-wasm-remote-catalog`.

## Scope

Remote File Gateway owns:

- same-origin virtual HTTP resources
- provider bindings and immutable object identity
- RAM-only provider credentials in the Service Worker
- `HEAD` and single-range `GET` semantics
- provider adapters such as Google Drive and HTTP Range
- optional bounded OPFS cache

It intentionally does **not** depend on DuckDB or any file format. DuckDB-Wasm is one possible HTTP Range consumer.

## Public API

```js
import {
  RemoteFileGateway,
  RemoteFileGatewayError,
} from './src/controller.mjs'

import { createRemoteFileGatewayHandler } from './src/service-worker-handler.js'
```

The default virtual resource shape is:

```text
/remote-file-gateway/objects/<immutable-object-id>
```

## Status

Experimental. The public API is still evolving.

## License

MIT
