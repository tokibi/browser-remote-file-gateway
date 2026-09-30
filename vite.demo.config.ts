import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "build/pages",
    emptyOutDir: false,
    lib: {
      entry: {
        "demo/app": resolve("demo/app.ts"),
        "quickstart/app": resolve("examples/quickstart/app.ts"),
        "service-worker": resolve("src/pages-service-worker.ts"),
      },
      formats: ["es"],
      fileName: (_, name) => `${name}.js`,
    },
  },
});
