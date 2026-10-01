---
title: Quickstart
description: Register the Gateway Service Worker, publish an HTTP Range binding, and read a virtual object.
---

# Quickstart

This guide publishes an object from an HTTP Range provider and reads its first 1 KiB through the Gateway. Run the page over HTTPS or localhost; Service Workers and OPFS require a secure context.

## 1. Serve the Gateway modules

Build the repository modules with `pnpm build`. Make the controller module available to your application, then serve `dist/service-worker.js` and `dist/service-worker-handler.js` together from your origin. The example below uses `/remote-file-gateway/` as their deployment directory:

```text
/remote-file-gateway/service-worker.js
/remote-file-gateway/service-worker-handler.js
```

The built `dist/service-worker.js` imports `./service-worker-handler.js` and owns the Service Worker lifecycle. Keep the two files together when copying them. The controller can be imported from the package root or bundled into your application. The import below uses this repository's package name; adjust it to match your local workspace or installation.

## 2. Register the Gateway

```js
import { RemoteFileGateway } from 'browser-remote-file-gateway'

const gateway = await RemoteFileGateway.register({
  serviceWorkerUrl: '/remote-file-gateway/service-worker.js',
  scope: '/',
  virtualBase: '/remote-file-gateway/',
})
```

The example uses a root scope while the Service Worker script lives in a subdirectory. Browsers require that script response to include `Service-Worker-Allowed: /` for this broader scope. If your host cannot set that header, serve the script at the origin root, or use a scope that contains the script directory and the page. The built standalone worker sets its virtual base to the directory where its script is served; keep `virtualBase` aligned with that path.

`register()` installs the module Service Worker, waits for it to control the page, and negotiates a compatible protocol. The call rejects if the expected registration does not control the page before `controlTimeoutMs` (20 seconds by default).

## 3. Publish a binding

Each publication replaces the complete set of active bindings. The revision is a non-negative `bigint` and must not go backwards. An object ID is an application-chosen stable identifier, such as a content hash plus a version label.

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

Supply the trusted object length and content version from your application's metadata. The Gateway checks that a range response is bounded and has the expected length; it does not compute an end-to-end content hash for uncached range reads.

## 4. Read the virtual object

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

Consumers may run on the main thread or in a Dedicated Worker. They use the virtual URL with `HEAD` or a single-range `GET`; a `GET` without `Range` is rejected.

## 5. Close the controller

```js
// If the application used Google Drive, clear the shared token before close.
await gateway.clearCredential('google-drive')
await gateway.close()
```

Closing removes this controller instance's `controllerchange` listener. It does not clear provider credentials shared by clients of the same Service Worker registration. Call `clearCredential()` before `close()` during logout when the application used Google Drive; a closed controller cannot make further control-plane requests.

## Use an existing Service Worker

If your application already has a module Service Worker, import the listener-free handler from the package's `service-worker-handler` subpath and route matching events to it before your fallback handlers:

```js
import { createRemoteFileGatewayHandler } from 'browser-remote-file-gateway/service-worker-handler'

const gatewayHandler = createRemoteFileGatewayHandler({
  virtualBase: '/remote-file-gateway/',
})

self.addEventListener('fetch', (event) => {
  if (gatewayHandler.handleFetch(event)) return
  // Continue with the host application's fetch handlers.
})

self.addEventListener('message', (event) => {
  if (gatewayHandler.handleMessage(event)) return
  // Continue with the host application's message handlers.
})
```

Connect the page controller to the active registration:

```js
const gateway = await RemoteFileGateway.connect({
  registration: await navigator.serviceWorker.ready,
  virtualBase: '/remote-file-gateway/',
})
```

In this mode the host owns install, activation, `skipWaiting()`, and `clients.claim()`. See [Concepts](./concepts.md) for the boundary between the controller, handler, and host application.
