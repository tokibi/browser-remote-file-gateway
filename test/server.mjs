import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";

const pagesRoot = resolve("build/pages");
const pagesPrefix = "/browser-remote-file-gateway/";
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
]);
const testFiles = new Map([
  ["remote-file-gateway/generic.html", "test/browser/public/generic.html"],
  ["remote-file-gateway/generic-contract.mjs", "test/browser/public/generic-contract.mjs"],
]);
let fixture = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);

function contentType(path) {
  return contentTypes.get(extname(path)) ?? "application/octet-stream";
}

function isValidRange(start, end, size) {
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < size && end >= start;
}

function rangeFromMatch(match, size) {
  const start = Number(match[1]);
  const end = Number(match[2] || size - 1);
  if (!isValidRange(start, end, size)) return null;
  return { start, end: Math.min(end, size - 1) };
}

function parseRange(value, size) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(value ?? "");
  return match === null ? null : rangeFromMatch(match, size);
}

function indexPath(relativePath) {
  if (relativePath.endsWith("/")) return `${relativePath}index.html`;
  return relativePath || "index.html";
}

function isWithinPagesRoot(path) {
  const rootRelativePath = relative(pagesRoot, path);
  return rootRelativePath !== ".." && !rootRelativePath.startsWith(`..${sep}`);
}

function fileForPagePath(relativePath) {
  const pagesPath = resolve(pagesRoot, indexPath(relativePath));
  if (!isWithinPagesRoot(pagesPath)) return null;
  return resolve(testFiles.get(relativePath) ?? pagesPath);
}

function writeByteResponse(request, response, status, headers, body) {
  response.writeHead(status, { ...headers, "Content-Length": body.byteLength });
  response.end(request.method === "HEAD" ? undefined : body);
}

function sendByteResponse(request, response, bytes, headers) {
  const rangeHeader = request.headers.range;
  if (!rangeHeader) {
    writeByteResponse(request, response, 200, headers, bytes);
    return;
  }

  const range = parseRange(rangeHeader, bytes.byteLength);
  if (range === null) {
    response.writeHead(416, { "Content-Range": `bytes */${bytes.byteLength}` }).end();
    return;
  }

  const body = bytes.subarray(range.start, range.end + 1);
  writeByteResponse(
    request,
    response,
    206,
    { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${bytes.byteLength}` },
    body,
  );
}

async function readPageBytes(relativePath) {
  const file = fileForPagePath(relativePath);
  if (file === null) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

function supportsPageMethod(method) {
  return method === "GET" || method === "HEAD";
}

function pageHeaders(relativePath) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType(relativePath),
    ...(relativePath === "service-worker.js" ? { "Service-Worker-Allowed": pagesPrefix } : {}),
  };
}

async function servePageRequest(request, relativePath, response) {
  if (!supportsPageMethod(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const bytes = await readPageBytes(relativePath);
  if (bytes === null) {
    response.writeHead(404).end();
    return;
  }

  sendByteResponse(request, response, bytes, pageHeaders(relativePath));
}

async function servePagesFile(request, pathname, response) {
  if (!pathname.startsWith(pagesPrefix)) return false;
  const relativePath = decodeURIComponent(pathname.slice(pagesPrefix.length));
  await servePageRequest(request, relativePath, response);
  return true;
}

async function updateFixture(request, pathname, response) {
  if (request.method !== "PUT" || pathname !== "/__fixture/gateway-generic") return false;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  fixture = Buffer.concat(chunks);
  response.writeHead(204).end();
  return true;
}

function serveFixtureData(request, pathname, response) {
  if (pathname !== "/fixture-data/gateway-generic") return false;
  sendByteResponse(request, response, fixture, {
    "Accept-Ranges": "bytes",
    "Content-Type": "application/octet-stream",
  });
  return true;
}

function serveGoogleDrive(request, pathname, response) {
  if (!pathname.startsWith("/fake-google-drive/drive/v3/files/")) return false;
  response.writeHead(403, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: 403, message: "denied" } }));
  return true;
}

const routeHandlers = [updateFixture, serveFixtureData, serveGoogleDrive, servePagesFile];

async function routeRequest(request, response) {
  const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1:4174");
  for (const handler of routeHandlers) {
    if (await handler(request, pathname, response)) return;
  }
  response.writeHead(404).end();
}

const server = createServer((request, response) => {
  routeRequest(request, response).catch((error) => {
    console.error(error);
    response.writeHead(500).end();
  });
});

server.listen(4174, "127.0.0.1", () => {
  process.stdout.write(`Remote File Gateway test server serving ${pagesRoot} at ${pagesPrefix}\n`);
});

const close = () => server.close(() => process.exit(0));
process.once("SIGINT", close);
process.once("SIGTERM", close);
