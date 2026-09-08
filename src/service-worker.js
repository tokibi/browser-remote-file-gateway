import { createRemoteFileGatewayHandler } from './service-worker-handler.js'

const handler = createRemoteFileGatewayHandler({
  virtualBase: '/remote-file-gateway/',
})

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => handler.handleFetch(event))
self.addEventListener('message', (event) => handler.handleMessage(event))
