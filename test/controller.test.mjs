import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RemoteFileGateway } from '../src/controller.mjs'

describe('RemoteFileGateway', () => {
  it('leaves consumer Worker creation to the host application', () => {
    assert.equal('createDuckDBWorker' in RemoteFileGateway.prototype, false)
  })

  it('does not retain the legacy controller export', async () => {
    const exports = await import('../src/controller.mjs')
    assert.equal('VirtualHttpFileSystemController' in exports, false)
  })

  it('exposes distinct standalone, integrated, and credential lifecycle APIs', () => {
    assert.equal(typeof RemoteFileGateway.register, 'function')
    assert.equal(typeof RemoteFileGateway.connect, 'function')
    assert.equal(typeof RemoteFileGateway.prototype.clearCredential, 'function')
  })

  it('repeats a handshake invalidated by controllerchange when the registration still controls', async () => {
    const originalNavigator = globalThis.navigator
    const originalLocation = globalThis.location
    const listeners = new Set()
    let helloCount = 0
    const controller = {
      scriptURL: 'https://app.example/host-service-worker.js',
      postMessage(message, ports) {
        helloCount += 1
        if (helloCount === 1) {
          for (const listener of listeners) listener()
        }
        ports[0].postMessage({
          ok: true,
          result: {
            protocolVersion: 1,
            virtualBase: '/remote-file-gateway/',
            capabilities: ['http-range', 'bounded-opfs-cache'],
          },
        })
      },
    }
    const registration = {
      scope: 'https://app.example/',
      active: controller,
    }
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'https://app.example', href: 'https://app.example/app' },
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          controller,
          addEventListener(type, listener) {
            if (type === 'controllerchange') listeners.add(listener)
          },
          removeEventListener(type, listener) {
            if (type === 'controllerchange') listeners.delete(listener)
          },
        },
      },
    })

    try {
      const gateway = await RemoteFileGateway.connect({ registration })
      assert.equal(helloCount, 2)
      await gateway.close()
      assert.equal(listeners.size, 0)
    } finally {
      if (originalNavigator === undefined) delete globalThis.navigator
      else Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      })
      if (originalLocation === undefined) delete globalThis.location
      else Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  for (const failure of ['handshake', 'configureCache']) {
    it(`removes its controllerchange listener when ${failure} fails during register`, async () => {
      const originalNavigator = globalThis.navigator
      const originalLocation = globalThis.location
      const listeners = new Set()
      const scriptURL = 'https://app.example/remote-file-gateway/service-worker.js'
      const controller = {
        scriptURL,
        postMessage(message, ports) {
          if (message.type === 'REMOTE_FILE_GATEWAY_HELLO' && failure !== 'handshake') {
            ports[0].postMessage({
              ok: true,
              result: {
                protocolVersion: 1,
                virtualBase: '/remote-file-gateway/',
                capabilities: ['http-range', 'bounded-opfs-cache'],
              },
            })
            return
          }
          ports[0].postMessage({
            ok: false,
            code: 'RC_TEST_INITIALIZATION_FAILURE',
            message: `${failure} failed`,
          })
        },
      }
      const registration = {
        scope: 'https://app.example/',
        active: controller,
      }
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { origin: 'https://app.example', href: 'https://app.example/app' },
      })
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
          serviceWorker: {
            controller,
            ready: Promise.resolve(registration),
            register: async () => registration,
            addEventListener(type, listener) {
              if (type === 'controllerchange') listeners.add(listener)
            },
            removeEventListener(type, listener) {
              if (type === 'controllerchange') listeners.delete(listener)
            },
          },
        },
      })

      try {
        await assert.rejects(
          RemoteFileGateway.register(),
          (error) => error?.code === 'RC_TEST_INITIALIZATION_FAILURE',
        )
        assert.equal(listeners.size, 0)
      } finally {
        if (originalNavigator === undefined) delete globalThis.navigator
        else Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: originalNavigator,
        })
        if (originalLocation === undefined) delete globalThis.location
        else Object.defineProperty(globalThis, 'location', {
          configurable: true,
          value: originalLocation,
        })
      }
    })
  }
})
