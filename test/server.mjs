import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve } from 'node:path'

const root = resolve('.')
let fixture = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])

function contentType(path) {
  switch (extname(path)) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function parseRange(value, size) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(value ?? '')
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
  if (start < 0 || start >= size || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:4174')

    if (request.method === 'PUT' && url.pathname === '/__fixture/gateway-generic') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      fixture = Buffer.concat(chunks)
      response.writeHead(204).end()
      return
    }

    if (url.pathname === '/fixture-data/gateway-generic') {
      const rangeHeader = request.headers.range
      if (rangeHeader) {
        const range = parseRange(rangeHeader, fixture.byteLength)
        if (!range) {
          response.setHeader('Content-Range', `bytes */${fixture.byteLength}`)
          response.writeHead(416).end()
          return
        }
        const body = fixture.subarray(range.start, range.end + 1)
        response.setHeader('Accept-Ranges', 'bytes')
        response.setHeader('Content-Length', body.byteLength)
        response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fixture.byteLength}`)
        response.setHeader('Content-Type', 'application/octet-stream')
        response.writeHead(206)
        if (request.method === 'HEAD') response.end()
        else response.end(body)
        return
      }

      response.setHeader('Accept-Ranges', 'bytes')
      response.setHeader('Content-Length', fixture.byteLength)
      response.setHeader('Content-Type', 'application/octet-stream')
      response.writeHead(200)
      if (request.method === 'HEAD') response.end()
      else response.end(fixture)
      return
    }

    if (url.pathname.startsWith('/fake-google-drive/drive/v3/files/')) {
      response.writeHead(403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 403, message: 'denied' } }))
      return
    }

    const staticFiles = new Map([
      ['/remote-file-gateway/controller.mjs', 'src/controller.mjs'],
      ['/remote-file-gateway/service-worker-handler.js', 'src/service-worker-handler.js'],
      ['/remote-file-gateway/service-worker.js', 'src/service-worker.js'],
      ['/remote-file-gateway/generic.html', 'test/browser/public/generic.html'],
      ['/remote-file-gateway/generic-contract.mjs', 'test/browser/public/generic-contract.mjs'],
    ])
    const file = staticFiles.get(url.pathname)
    if (file) {
      const bytes = await readFile(resolve(root, file))
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Type', contentType(file))
      response.setHeader('Content-Length', bytes.byteLength)
      if (url.pathname === '/remote-file-gateway/service-worker.js') {
        response.setHeader('Service-Worker-Allowed', '/')
      }
      response.writeHead(200).end(bytes)
      return
    }

    response.writeHead(404).end()
  } catch (error) {
    console.error(error)
    response.writeHead(500).end()
  }
})

server.listen(4174, '127.0.0.1', () => {
  process.stdout.write('Remote File Gateway test server listening at http://127.0.0.1:4174\n')
})

const close = () => server.close(() => process.exit(0))
process.once('SIGINT', close)
process.once('SIGTERM', close)
