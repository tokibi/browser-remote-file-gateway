import { expect, test } from '@playwright/test'

interface ResponseDetails {
  status: number
  contentLength: string | null
  contentRange: string | null
  contentType: string | null
  acceptRanges: string | null
  allow: string | null
  errorCode: string | null
  body: number[]
}

interface GenericContractResult {
  uri: string
  normalHead: ResponseDetails
  rangeHead: ResponseDetails
  bounded: ResponseDetails
  openEnded: ResponseDetails
  invalidRanges: ResponseDetails[]
  nonRange: ResponseDetails
  unsupportedMethod: ResponseDetails
  missing: ResponseDetails
  authenticationRequired: ResponseDetails
  authorizationDenied: ResponseDetails
  outside: ResponseDetails
  legacy: ResponseDetails
}

declare global {
  interface Window {
    remoteFileGatewayGenericContract?: {
      run(maxFullObjectCacheBytes: number): Promise<GenericContractResult>
    }
  }
}

for (const [cacheName, maxFullObjectCacheBytes] of [
  ['disabled', 0],
  ['enabled', 64],
] as const) {
  test(`serves the format-neutral generic HTTP contract with OPFS cache ${cacheName}`, async ({
    page,
  }) => {
    await page.goto('/remote-file-gateway/generic.html')
    const result = await page.evaluate(
      (threshold) => window.remoteFileGatewayGenericContract!.run(threshold),
      maxFullObjectCacheBytes,
    )

    expect(result.uri).toMatch(
      /^http:\/\/127\.0\.0\.1:4174\/remote-file-gateway\/objects\/generic-http-r1$/,
    )
    expect(result.normalHead).toMatchObject({
      status: 200,
      contentLength: '8',
      contentRange: null,
      contentType: 'application/x-generic-fixture',
      acceptRanges: 'bytes',
      body: [],
    })
    expect(result.rangeHead).toMatchObject({
      status: 206,
      contentLength: '3',
      contentRange: 'bytes 2-4/8',
      body: [],
    })
    expect(result.bounded).toMatchObject({
      status: 206,
      contentLength: '3',
      contentRange: 'bytes 2-4/8',
      body: [2, 3, 4],
    })
    expect(result.openEnded).toMatchObject({
      status: 206,
      contentLength: '3',
      contentRange: 'bytes 5-7/8',
      body: [5, 6, 7],
    })
    for (const response of result.invalidRanges) {
      expect(response).toMatchObject({
        status: 416,
        contentRange: 'bytes */8',
        errorCode: 'RC_RANGE_NOT_SATISFIABLE',
      })
    }
    expect(result.nonRange).toMatchObject({
      status: 400,
      errorCode: 'RC_RANGE_REQUIRED',
    })
    expect(result.unsupportedMethod).toMatchObject({
      status: 405,
      allow: 'GET, HEAD',
      errorCode: 'RC_METHOD_NOT_ALLOWED',
    })
    expect(result.missing).toMatchObject({
      status: 404,
      errorCode: 'RC_OBJECT_NOT_FOUND',
    })
    expect(result.authenticationRequired).toMatchObject({
      status: 401,
      errorCode: 'RC_AUTHENTICATION_REQUIRED',
    })
    expect(result.authorizationDenied).toMatchObject({
      status: 403,
      errorCode: 'RC_AUTHORIZATION_DENIED',
    })
    expect(result.outside).toMatchObject({
      status: 206,
      contentRange: 'bytes 0-1/8',
      body: [0, 1],
    })
    expect(result.legacy).toMatchObject({
      status: 404,
      errorCode: null,
    })
  })
}
