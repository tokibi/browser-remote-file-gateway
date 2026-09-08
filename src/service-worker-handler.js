const OBJECT_ID_PATTERN = '([a-z0-9][a-z0-9-]{0,127})'
const DATABASE_NAME = 'remote-file-gateway'
const BINDING_STORE = 'provider-bindings'
const IDENTITY_STORE = 'object-identities'
const CACHE_STORE = 'cache-metadata'
const STATE_STORE = 'state'
const CACHE_DIRECTORY = 'remote-file-gateway-cache'
const PROVIDER_TIMEOUT_MS = 20_000
const MAX_DIAGNOSTIC_ENTRIES = 1_000
const ERROR_HEADER = 'X-Remote-File-Gateway-Error-Code'
const MESSAGE_PREFIX = 'REMOTE_FILE_GATEWAY_'
const PROTOCOL_VERSIONS = Object.freeze([1])
const CAPABILITIES = Object.freeze(['http-range', 'bounded-opfs-cache'])

export function createRemoteFileGatewayHandler(options = {}) {
  const virtualBase = normalizeVirtualBase(options.virtualBase ?? '/remote-file-gateway/')
  const objectPath = new RegExp(`^${escapeRegExp(virtualBase)}objects/${OBJECT_ID_PATTERN}$`)
  let maxFullObjectCacheBytes = 0
  let diagnostics = emptyDiagnostics()
  const credentials = new Map()
  const resolvedObjects = new Map()
  const verifiedCacheVersions = new Set()

  function handleFetch(event) {
    const url = new URL(event.request.url)
    if (url.origin !== self.location.origin) return false
    const match = objectPath.exec(url.pathname)
    if (!match?.[1]) return false
    event.respondWith(serveSafely(event.request, match[1]))
    return true
  }

  function handleMessage(event) {
    if (typeof event.data?.type !== 'string' || !event.data.type.startsWith(MESSAGE_PREFIX)) {
      return false
    }
    const operation = Promise.resolve().then(() => processMessage(event))
    event.waitUntil(operation)
    return true
  }

  function processMessage(event) {
    const reply = event.ports?.[0]
    if (!reply) return
    const respond = (result) => reply.postMessage({ ok: true, result })
    const reject = (error) =>
      reply.postMessage({
        ok: false,
        code: error instanceof VirtualFileError ? error.code : 'RC_GATEWAY_ERROR',
        message: error instanceof Error ? error.message : 'Service Worker operation failed',
      })
    try {
      switch (event.data?.type) {
        case 'REMOTE_FILE_GATEWAY_HELLO': {
          const requestedVersions = Array.isArray(event.data.protocolVersions)
            ? event.data.protocolVersions
            : []
          const protocolVersion = PROTOCOL_VERSIONS.find((version) =>
            requestedVersions.includes(version),
          )
          if (protocolVersion === undefined) {
            throw new VirtualFileError(
              'RC_GATEWAY_PROTOCOL_UNSUPPORTED',
              400,
              'No compatible Remote File Gateway protocol version',
            )
          }
          respond({
            protocolVersion,
            virtualBase,
            capabilities: [...CAPABILITIES],
          })
          return
        }
        case 'REMOTE_FILE_GATEWAY_SET_CREDENTIAL': {
          const { provider, credential } = event.data
          credentials.set(provider, Object.freeze({ ...credential }))
          resolvedObjects.clear()
          respond({ generation: credential.generation, expiresAt: credential.expiresAt })
          return
        }
        case 'REMOTE_FILE_GATEWAY_CLEAR_CREDENTIAL':
          credentials.delete(event.data.provider)
          resolvedObjects.clear()
          respond(undefined)
          return
        case 'REMOTE_FILE_GATEWAY_CONFIGURE_CACHE':
          maxFullObjectCacheBytes = event.data.maxFullObjectCacheBytes
          respond({ maxFullObjectCacheBytes })
          return
        case 'REMOTE_FILE_GATEWAY_INVALIDATE_BINDINGS':
          resolvedObjects.clear()
          verifiedCacheVersions.clear()
          respond(undefined)
          return
        case 'REMOTE_FILE_GATEWAY_GET_DIAGNOSTICS':
          respond(structuredClone(diagnostics))
          return
        case 'REMOTE_FILE_GATEWAY_RESET_DIAGNOSTICS':
          diagnostics = emptyDiagnostics()
          respond(undefined)
          return
        default:
          reject(new VirtualFileError('RC_MESSAGE_UNSUPPORTED', 400, 'Unsupported message'))
      }
    } catch (error) {
      reject(error)
    }
  }

  function normalizeVirtualBase(value) {
    if (typeof value !== 'string' || !/^\/(?:[^?#]*\/)?$/.test(value)) {
      throw new TypeError('virtualBase must be an absolute path ending in slash')
    }
    return value
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  class VirtualFileError extends Error {
    constructor(code, status, message, headers = undefined) {
      super(message)
      this.name = 'VirtualFileError'
      this.code = code
      this.status = status
      this.headers = headers
    }
  }

  function emptyDiagnostics() {
    return {
      resolverCalls: [],
      providerRequests: [],
      virtualRequests: [],
      cacheHits: [],
      cacheMisses: [],
      cacheWrites: [],
      cacheBypasses: [],
      cacheRejections: [],
      failures: [],
    }
  }

  function recordDiagnostic(name, value) {
    const entries = diagnostics[name]
    if (entries.length === MAX_DIAGNOSTIC_ENTRIES) entries.shift()
    entries.push(value)
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 2)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(BINDING_STORE)) {
          request.result.createObjectStore(BINDING_STORE, { keyPath: 'objectId' })
        }
        if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
          request.result.createObjectStore(CACHE_STORE, { keyPath: 'cacheKey' })
        }
        if (!request.result.objectStoreNames.contains(STATE_STORE)) {
          request.result.createObjectStore(STATE_STORE, { keyPath: 'key' })
        }
        if (!request.result.objectStoreNames.contains(IDENTITY_STORE)) {
          request.result.createObjectStore(IDENTITY_STORE, { keyPath: 'objectId' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function readRecord(storeName, key) {
    const database = await openDatabase()
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  }

  async function writeRecord(storeName, record) {
    const database = await openDatabase()
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite')
        transaction.objectStore(storeName).put(record)
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }

  async function deleteRecord(storeName, key) {
    const database = await openDatabase()
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite')
        transaction.objectStore(storeName).delete(key)
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }

  function currentCredential(provider) {
    const credential = credentials.get(provider)
    if (!credential || credential.expiresAt <= Date.now()) {
      throw new VirtualFileError(
        'RC_AUTHENTICATION_REQUIRED',
        401,
        'Provider authentication is required',
      )
    }
    return credential
  }

  async function providerFetch(url, init) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, cache: 'no-store', signal: controller.signal })
    } catch {
      throw new VirtualFileError('RC_REMOTE_FETCH_FAILED', 502, 'Remote provider request failed')
    } finally {
      clearTimeout(timeout)
    }
  }

  function providerStatusError(status) {
    if (status === 401) {
      return new VirtualFileError(
        'RC_AUTHENTICATION_REQUIRED',
        401,
        'Provider authentication failed',
      )
    }
    if (status === 403) {
      return new VirtualFileError('RC_AUTHORIZATION_DENIED', 403, 'Provider authorization failed')
    }
    if (status === 404) {
      return new VirtualFileError('RC_OBJECT_NOT_FOUND', 404, 'Provider object is missing')
    }
    return new VirtualFileError('RC_REMOTE_FETCH_FAILED', 502, 'Remote provider request failed')
  }

  function googleDriveUrl(binding, media) {
    const url = new URL(`drive/v3/files/${encodeURIComponent(binding.fileId)}`, binding.apiBase)
    url.searchParams.set('supportsAllDrives', 'true')
    if (media) {
      url.searchParams.set('alt', 'media')
    } else {
      url.searchParams.set('fields', 'id,size,md5Checksum,mimeType,capabilities(canDownload)')
    }
    return url
  }

  async function resolveObject(objectId) {
    const binding = await readRecord(BINDING_STORE, objectId)
    if (!binding)
      throw new VirtualFileError('RC_OBJECT_NOT_FOUND', 404, 'Provider binding is missing')
    const credential =
      binding.provider === 'google-drive' ? currentCredential(binding.provider) : null
    const cacheKey = `${binding.bindingRevision}:${credential?.generation ?? 'public'}:${objectId}`
    const cached = resolvedObjects.get(cacheKey)
    if (cached) return cached

    let resolved
    if (binding.provider === 'google-drive') {
      const startedAt = performance.now()
      const response = await providerFetch(googleDriveUrl(binding, false), {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      })
      recordDiagnostic('providerRequests', {
        operation: 'metadata',
        method: 'GET',
        range: null,
        status: response.status,
        responseBytes: Number(response.headers.get('Content-Length')) || 0,
        credentialGeneration: credential.generation,
        durationMs: performance.now() - startedAt,
      })
      if (!response.ok) throw providerStatusError(response.status)
      const metadata = await response.json()
      if (
        metadata?.id !== binding.fileId ||
        metadata?.size !== String(binding.bytes) ||
        metadata?.md5Checksum !== binding.contentVersion ||
        metadata?.capabilities?.canDownload !== true
      ) {
        throw new VirtualFileError(
          'RC_CONTENT_REVISION_CHANGED',
          409,
          'Provider content revision changed',
        )
      }
      resolved = { ...binding, mimeType: metadata.mimeType || binding.mimeType }
    } else if (binding.provider === 'http-range') {
      resolved = binding
    } else {
      throw new VirtualFileError('RC_PROVIDER_UNSUPPORTED', 500, 'Provider is unsupported')
    }

    recordDiagnostic('resolverCalls', {
      objectId,
      provider: binding.provider,
      credentialGeneration: credential?.generation ?? 'public',
    })
    resolvedObjects.set(cacheKey, resolved)
    return resolved
  }

  function parseRange(value, size) {
    if (value === null) return null
    const match = /^bytes=(\d+)-(\d*)$/.exec(value)
    if (!match) return undefined
    const start = Number(match[1])
    const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start
    ) {
      return undefined
    }
    return { start, end }
  }

  function responseHeaders(source) {
    const headers = new Headers()
    for (const name of [
      'Accept-Ranges',
      'Cache-Control',
      'Content-Length',
      'Content-Range',
      'Content-Type',
    ]) {
      const value = source.get(name)
      if (value !== null) headers.set(name, value)
    }
    return headers
  }

  async function fetchProviderBody(binding, range) {
    const headers = new Headers()
    if (range !== null) headers.set('Range', range)
    let url
    let credentialGeneration = 'public'
    if (binding.provider === 'google-drive') {
      const credential = currentCredential(binding.provider)
      headers.set('Authorization', `Bearer ${credential.accessToken}`)
      credentialGeneration = credential.generation
      url = googleDriveUrl(binding, true)
    } else {
      url = binding.locator
    }
    return {
      response: await providerFetch(url, { method: 'GET', headers }),
      credentialGeneration,
    }
  }

  async function serveRemote(request, objectId, binding, range) {
    recordDiagnostic('cacheBypasses', {
      objectId,
      bytes: binding.bytes,
      maxFullObjectCacheBytes,
    })
    const rangeHeader = request.headers.get('Range')
    if (request.method === 'HEAD') {
      return virtualResponse(request, objectId, binding, range, null)
    }

    const startedAt = performance.now()
    const { response, credentialGeneration } = await fetchProviderBody(binding, rangeHeader)
    const responseBytes = Number(response.headers.get('Content-Length')) || 0
    recordDiagnostic('providerRequests', {
      operation: 'media',
      method: 'GET',
      range: rangeHeader,
      status: response.status,
      responseBytes,
      credentialGeneration,
      durationMs: performance.now() - startedAt,
      streamed: response.status === 206,
    })
    if (!response.ok) throw providerStatusError(response.status)
    const expectedContentRange = `bytes ${range.start}-${range.end}/${binding.bytes}`
    const contentRange = response.headers.get('Content-Range')
    if (
      response.status !== 206 ||
      responseBytes !== range.end - range.start + 1 ||
      (contentRange !== null && contentRange !== expectedContentRange)
    ) {
      await response.body?.cancel()
      throw new VirtualFileError(
        'RC_RANGE_UNSUPPORTED',
        502,
        'Provider did not return a bounded Range response',
      )
    }
    recordDiagnostic('virtualRequests', {
      objectId,
      method: 'GET',
      range: rangeHeader,
      status: 206,
    })
    return new Response(response.body, {
      status: 206,
      statusText: response.statusText,
      headers: responseHeaders(response.headers),
    })
  }

  function virtualResponse(request, objectId, binding, range, body) {
    const start = range?.start ?? 0
    const end = range?.end ?? binding.bytes - 1
    const status = range ? 206 : 200
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': String(end - start + 1),
      'Content-Type': binding.mimeType,
    })
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${binding.bytes}`)
    recordDiagnostic('virtualRequests', {
      objectId,
      method: request.method,
      range: request.headers.get('Range'),
      status,
    })
    return new Response(body, { status, headers })
  }

  async function cacheDirectory() {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(CACHE_DIRECTORY, { create: true })
  }

  function cacheFileName(objectId) {
    return `${objectId}.bin`
  }

  async function sha256(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  async function readCacheFile(objectId) {
    try {
      const directory = await cacheDirectory()
      const handle = await directory.getFileHandle(cacheFileName(objectId))
      return handle.getFile()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null
      throw error
    }
  }

  async function readCommittedCache(objectId, binding) {
    const [metadata, file] = await Promise.all([
      readRecord(CACHE_STORE, objectId),
      readCacheFile(objectId),
    ])
    if (!metadata && !file) {
      recordDiagnostic('cacheMisses', { objectId })
      return null
    }
    if (
      !metadata ||
      !file ||
      metadata.state !== 'committed' ||
      metadata.bytes !== binding.bytes ||
      metadata.contentVersion !== binding.contentVersion ||
      metadata.bytes > maxFullObjectCacheBytes ||
      file.size !== metadata.bytes
    ) {
      recordDiagnostic('cacheRejections', { objectId, reason: 'incomplete-or-stale' })
      await deleteRecord(CACHE_STORE, objectId)
      return null
    }
    const version = `${objectId}:${file.size}:${file.lastModified}:${metadata.sha256}`
    if (!verifiedCacheVersions.has(version)) {
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength > maxFullObjectCacheBytes || (await sha256(bytes)) !== metadata.sha256) {
        recordDiagnostic('cacheRejections', { objectId, reason: 'integrity' })
        await deleteRecord(CACHE_STORE, objectId)
        return null
      }
      verifiedCacheVersions.add(version)
    }
    recordDiagnostic('cacheHits', { objectId, bytes: file.size })
    return file
  }

  async function fetchAndCommitCache(objectId, binding) {
    const { response } = await fetchProviderBody(binding, null)
    if (!response.ok) throw providerStatusError(response.status)
    const declaredBytes = Number(response.headers.get('Content-Length'))
    if (declaredBytes !== binding.bytes || declaredBytes > maxFullObjectCacheBytes) {
      await response.body?.cancel()
      throw new VirtualFileError(
        'RC_CACHE_BODY_INVALID',
        502,
        'Provider full body exceeded cache policy',
      )
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength !== binding.bytes || bytes.byteLength > maxFullObjectCacheBytes) {
      throw new VirtualFileError('RC_CACHE_BODY_INVALID', 502, 'Provider full body size changed')
    }
    const digest = await sha256(bytes)
    const directory = await cacheDirectory()
    const handle = await directory.getFileHandle(cacheFileName(objectId), { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
    const file = await handle.getFile()
    await writeRecord(CACHE_STORE, {
      cacheKey: objectId,
      bytes: binding.bytes,
      contentVersion: binding.contentVersion,
      sha256: digest,
      state: 'committed',
    })
    verifiedCacheVersions.add(`${objectId}:${file.size}:${file.lastModified}:${digest}`)
    recordDiagnostic('cacheWrites', { objectId, bytes: file.size })
    return file
  }

  async function maybeCachedFile(objectId, binding) {
    if (maxFullObjectCacheBytes === 0 || binding.bytes > maxFullObjectCacheBytes) return null
    try {
      return (
        (await readCommittedCache(objectId, binding)) ??
        (await fetchAndCommitCache(objectId, binding))
      )
    } catch (error) {
      recordDiagnostic('cacheRejections', { objectId, reason: 'cache-unavailable' })
      return null
    }
  }

  async function serveCached(request, objectId, binding, file, range) {
    const start = range?.start ?? 0
    const end = range?.end ?? binding.bytes - 1
    const body = request.method === 'HEAD' ? null : file.slice(start, end + 1)
    return virtualResponse(request, objectId, binding, range, body)
  }

  async function serveObject(request, objectId) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      throw new VirtualFileError('RC_METHOD_NOT_ALLOWED', 405, 'Only GET and HEAD are supported', {
        Allow: 'GET, HEAD',
      })
    }
    if (request.method === 'GET' && request.headers.get('Range') === null) {
      throw new VirtualFileError('RC_RANGE_REQUIRED', 400, 'A valid Range GET is required')
    }
    const binding = await resolveObject(objectId)
    const range = parseRange(request.headers.get('Range'), binding.bytes)
    if (range === undefined) {
      throw new VirtualFileError(
        'RC_RANGE_NOT_SATISFIABLE',
        416,
        'The requested byte range is not satisfiable',
        { 'Content-Range': `bytes */${binding.bytes}` },
      )
    }
    const file = await maybeCachedFile(objectId, binding)
    if (file) return serveCached(request, objectId, binding, file, range)
    return serveRemote(request, objectId, binding, range)
  }

  async function serveSafely(request, objectId) {
    try {
      return await serveObject(request, objectId)
    } catch (error) {
      const failure =
        error instanceof VirtualFileError
          ? error
          : new VirtualFileError('RC_PROVIDER_FAILED', 500, 'Virtual file request failed')
      recordDiagnostic('failures', { objectId, code: failure.code, status: failure.status })
      const headers = new Headers(failure.headers)
      headers.set(ERROR_HEADER, failure.code)
      headers.set('Content-Type', 'text/plain; charset=utf-8')
      return new Response(failure.message, {
        status: failure.status,
        headers,
      })
    }
  }

  return Object.freeze({ handleFetch, handleMessage })
}
