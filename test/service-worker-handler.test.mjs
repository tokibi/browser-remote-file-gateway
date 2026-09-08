import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

const originalSelf = globalThis.self
const globalListeners = []

before(() => {
  globalThis.self = {
    location: { origin: 'https://app.example' },
    addEventListener(type) {
      globalListeners.push(type)
    },
  }
})

after(() => {
  if (originalSelf === undefined) delete globalThis.self
  else globalThis.self = originalSelf
})

describe('createRemoteFileGatewayHandler', async () => {
  const handlerModule = await import('../src/service-worker-handler.js')
  const { createRemoteFileGatewayHandler } = handlerModule

  it('does not register global Service Worker listeners', () => {
    assert.deepEqual(globalListeners, [])
    assert.equal('createVirtualHttpFileSystemHandler' in handlerModule, false)
  })

  it('claims only matching fetch requests and calls respondWith synchronously', async () => {
    const handler = createRemoteFileGatewayHandler({
      virtualBase: '/remote-file-gateway/',
    })
    let responsePromise
    const matchingEvent = {
      request: new Request('https://app.example/remote-file-gateway/objects/missing', {
        method: 'HEAD',
      }),
      respondWith(value) {
        responsePromise = value
      },
    }
    const outsideEvent = {
      request: new Request('https://app.example/outside'),
      respondWith() {
        throw new Error('outside request was claimed')
      },
    }

    assert.equal(handler.handleFetch(outsideEvent), false)
    assert.equal(handler.handleFetch(matchingEvent), true)
    assert.ok(responsePromise instanceof Promise)
    assert.equal((await responsePromise).status, 500)
  })

  it('claims only protocol messages and retains handled work with waitUntil', async () => {
    const handler = createRemoteFileGatewayHandler({
      virtualBase: '/remote-file-gateway/',
    })
    let reply
    let retainedWork
    const port = {
      postMessage(value) {
        reply = value
      },
    }
    const handledEvent = {
      data: { type: 'REMOTE_FILE_GATEWAY_RESET_DIAGNOSTICS' },
      ports: [port],
      waitUntil(value) {
        retainedWork = value
      },
    }
    const outsideEvent = {
      data: { type: 'HOST_MESSAGE' },
      ports: [port],
      waitUntil() {
        throw new Error('outside message was claimed')
      },
    }

    assert.equal(handler.handleMessage(outsideEvent), false)
    assert.equal(handler.handleMessage(handledEvent), true)
    assert.ok(retainedWork instanceof Promise)
    await retainedWork
    assert.deepEqual(reply, { ok: true, result: undefined })
  })

  it('claims unsupported messages inside its namespace and returns a protocol error', async () => {
    const handler = createRemoteFileGatewayHandler({
      virtualBase: '/remote-file-gateway/',
    })
    let reply
    let retainedWork
    const event = {
      data: { type: 'REMOTE_FILE_GATEWAY_UNKNOWN' },
      ports: [
        {
          postMessage(value) {
            reply = value
          },
        },
      ],
      waitUntil(value) {
        retainedWork = value
      },
    }

    assert.equal(handler.handleMessage(event), true)
    await retainedWork
    assert.deepEqual(reply, {
      ok: false,
      code: 'RC_MESSAGE_UNSUPPORTED',
      message: 'Unsupported message',
    })
  })

  it('negotiates the Gateway protocol and reports its configured capabilities', async () => {
    const handler = createRemoteFileGatewayHandler({
      virtualBase: '/remote-file-gateway/',
    })
    let reply
    let retainedWork
    const event = {
      data: {
        type: 'REMOTE_FILE_GATEWAY_HELLO',
        protocolVersions: [2, 1],
        virtualBase: '/remote-file-gateway/',
      },
      ports: [{ postMessage(value) { reply = value } }],
      waitUntil(value) { retainedWork = value },
    }

    assert.equal(handler.handleMessage(event), true)
    await retainedWork
    assert.deepEqual(reply, {
      ok: true,
      result: {
        protocolVersion: 1,
        virtualBase: '/remote-file-gateway/',
        capabilities: ['http-range', 'bounded-opfs-cache'],
      },
    })
  })

  it('rejects a HELLO without a compatible protocol version', async () => {
    const handler = createRemoteFileGatewayHandler()
    let reply
    let retainedWork
    const event = {
      data: {
        type: 'REMOTE_FILE_GATEWAY_HELLO',
        protocolVersions: [99],
        virtualBase: '/remote-file-gateway/',
      },
      ports: [{ postMessage(value) { reply = value } }],
      waitUntil(value) { retainedWork = value },
    }

    handler.handleMessage(event)
    await retainedWork
    assert.equal(reply.ok, false)
    assert.equal(reply.code, 'RC_GATEWAY_PROTOCOL_UNSUPPORTED')
  })
})
