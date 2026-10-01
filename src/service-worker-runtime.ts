import { createRemoteFileGatewayHandler } from "./service-worker-handler";

export function attachGatewayWorker(virtualBase: string): void {
  const worker = self as unknown as ServiceWorkerGlobalScope;
  const handler = createRemoteFileGatewayHandler({ virtualBase });
  worker.addEventListener("install", (event) => event.waitUntil(worker.skipWaiting()));
  worker.addEventListener("activate", (event) => event.waitUntil(worker.clients.claim()));
  worker.addEventListener("fetch", (event) => handler.handleFetch(event));
  worker.addEventListener("message", (event) => {
    if (event.data?.type === "REMOTE_FILE_GATEWAY_CLAIM_CLIENTS") {
      event.waitUntil(worker.clients.claim());
      return;
    }
    handler.handleMessage(event);
  });
}
