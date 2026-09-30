import { attachGatewayWorker } from "./service-worker-runtime";

attachGatewayWorker(new URL("./remote-file-gateway/", self.location.href).pathname);
