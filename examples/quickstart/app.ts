import { RemoteFileGateway } from "../../src/controller";

async function runQuickstart(): Promise<string> {
  const base = new URL("../", location.href).pathname;
  const source = new URL("../demo/sample.txt", location.href);
  const size = Number((await fetch(source, { method: "HEAD" })).headers.get("Content-Length"));
  const gateway = await RemoteFileGateway.register({
    serviceWorkerUrl: `${base}service-worker.js`,
    scope: base,
    virtualBase: `${base}remote-file-gateway/`,
  });
  try {
    await gateway.publishBindings(BigInt(Date.now()), [
      {
        objectId: "quickstart-sample-v1",
        provider: "http-range",
        locator: source.href,
        bytes: size,
        contentVersion: "sample-v1",
      },
    ]);
    const uri = gateway.virtualUri("quickstart-sample-v1");
    const head = await fetch(uri, { method: "HEAD" });
    const range = await fetch(uri, { headers: { Range: "bytes=0-15" } });
    if (!head.ok || range.status !== 206) {
      throw new Error(`Gateway returned HEAD ${head.status}, Range GET ${range.status}`);
    }
    return JSON.stringify(
      {
        size: head.headers.get("Content-Length"),
        range: range.headers.get("Content-Range"),
        text: await range.text(),
      },
      null,
      2,
    );
  } finally {
    await gateway.close();
  }
}

document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  const result = document.querySelector<HTMLElement>("#result")!;
  try {
    result.textContent = await runQuickstart();
  } catch (error) {
    result.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
};
