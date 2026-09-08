import { RemoteFileGateway } from '/remote-file-gateway/controller.mjs'

const FIXTURE = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])
const ERROR_HEADER = 'X-Remote-File-Gateway-Error-Code'

async function responseDetails(response, includeBody = false) {
  return {
    status: response.status,
    contentLength: response.headers.get('Content-Length'),
    contentRange: response.headers.get('Content-Range'),
    contentType: response.headers.get('Content-Type'),
    acceptRanges: response.headers.get('Accept-Ranges'),
    allow: response.headers.get('Allow'),
    errorCode: response.headers.get(ERROR_HEADER),
    body: includeBody ? Array.from(new Uint8Array(await response.arrayBuffer())) : [],
  }
}

async function run(maxFullObjectCacheBytes) {
  await fetch('/__fixture/gateway-generic', { method: 'PUT', body: FIXTURE })
  const gateway = await RemoteFileGateway.initialize({
    maxFullObjectCacheBytes,
  })
  try {
    await gateway.publishBindings(1n, [
      {
        objectId: 'generic-http-r1',
        provider: 'http-range',
        locator: `${location.origin}/fixture-data/gateway-generic?range=1`,
        bytes: FIXTURE.byteLength,
        contentVersion: 'generic-http-r1',
        mimeType: 'application/x-generic-fixture',
      },
      {
        objectId: 'generic-drive-denied-r1',
        provider: 'google-drive',
        fileId: 'drive-large-primary-000001',
        apiBase: `${location.origin}/fake-google-drive/`,
        bytes: 84_358_018,
        contentVersion: '0123456789abcdef0123456789abcdef',
        mimeType: 'application/octet-stream',
      },
    ])
    const uri = gateway.virtualUri('generic-http-r1')
    const missingUri = gateway.virtualUri('generic-missing-r1')
    const deniedUri = gateway.virtualUri('generic-drive-denied-r1')

    const normalHead = await responseDetails(await fetch(uri, { method: 'HEAD' }))
    const rangeHead = await responseDetails(
      await fetch(uri, {
        method: 'HEAD',
        headers: { Range: 'bytes=2-4' },
      }),
    )
    const bounded = await responseDetails(
      await fetch(uri, {
        headers: { Range: 'bytes=2-4' },
      }),
      true,
    )
    const openEnded = await responseDetails(
      await fetch(uri, {
        headers: { Range: 'bytes=5-' },
      }),
      true,
    )
    const invalidRanges = []
    for (const range of ['bytes=8-', 'bytes=4-2', 'bytes=0-1,3-4', 'bytes=-3', 'invalid']) {
      invalidRanges.push(await responseDetails(await fetch(uri, { headers: { Range: range } })))
    }
    const nonRange = await responseDetails(await fetch(uri))
    const unsupportedMethod = await responseDetails(await fetch(uri, { method: 'POST' }))
    const missing = await responseDetails(await fetch(missingUri, { method: 'HEAD' }))
    const authenticationRequired = await responseDetails(await fetch(deniedUri, { method: 'HEAD' }))
    await gateway.setCredential('google-drive', {
      accessToken: 'fake-denied',
      generation: 'generic-denied',
      expiresAt: Date.now() + 60_000,
    })
    const authorizationDenied = await responseDetails(await fetch(deniedUri, { method: 'HEAD' }))
    const outside = await responseDetails(
      await fetch(`${location.origin}/fixture-data/gateway-generic?range=1`, {
        headers: { Range: 'bytes=0-1' },
      }),
      true,
    )
    const legacy = await responseDetails(
      await fetch(`${location.origin}/virtual-http-filesystem/objects/generic-http-r1.parquet`, {
        method: 'HEAD',
      }),
    )

    return {
      uri,
      normalHead,
      rangeHead,
      bounded,
      openEnded,
      invalidRanges,
      nonRange,
      unsupportedMethod,
      missing,
      authenticationRequired,
      authorizationDenied,
      outside,
      legacy,
    }
  } finally {
    await gateway.close()
    await gateway.registration.unregister()
  }
}

window.remoteFileGatewayGenericContract = { run }
