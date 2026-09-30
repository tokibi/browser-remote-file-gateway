import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: {
        controller: resolve("src/controller.ts"),
        "service-worker-handler": resolve("src/service-worker-handler.ts"),
        "service-worker": resolve("src/service-worker.ts"),
      },
      formats: ["es"],
      fileName: (_, name) => (name === "controller" ? "controller.mjs" : `${name}.js`),
    },
  },
});
