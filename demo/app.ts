import { RemoteFileGateway } from "../src/controller";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#output")!;

async function runDemo() {
  let gateway: RemoteFileGateway | undefined;
  try {
    const projectBase = new URL("../", location.href).pathname;
    const source = new URL("./sample.txt", location.href);
    const sourceHead = await fetch(source, { method: "HEAD" });
    if (!sourceHead.ok) throw new Error(`Source HEAD returned ${sourceHead.status}`);
    const bytes = Number(sourceHead.headers.get("Content-Length"));
    gateway = await RemoteFileGateway.register({
      serviceWorkerUrl: `${projectBase}service-worker.js`,
      scope: projectBase,
      virtualBase: `${projectBase}remote-file-gateway/`,
    });
    await gateway.publishBindings(BigInt(Date.now()), [
      {
        objectId: "demo-text-v1",
        provider: "http-range",
        locator: source.href,
        bytes,
        contentVersion: "demo-text-v1",
        mimeType: "text/plain",
      },
    ]);
    const uri = gateway.virtualUri("demo-text-v1");
    const head = await fetch(uri, { method: "HEAD" });
    const range = await fetch(uri, { headers: { Range: "bytes=0-31" } });
    const body = await range.text();
    if (!head.ok || range.status !== 206) throw new Error("Gateway response was unsuccessful");
    return JSON.stringify(
      {
        uri,
        head: { status: head.status, bytes: head.headers.get("Content-Length") },
        range: { status: range.status, contentRange: range.headers.get("Content-Range"), body },
      },
      null,
      2,
    );
  } finally {
    await gateway?.close();
  }
}

run.addEventListener("click", async () => {
  run.disabled = true;
  status.textContent = "Registering the Service Worker…";
  try {
    output.textContent = await runDemo();
    status.textContent = "HEAD and Range GET succeeded";
  } catch (error) {
    status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    run.disabled = false;
  }
});
