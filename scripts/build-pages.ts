import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("build/pages");
const gateway = resolve(root, "remote-file-gateway");
await rm(root, { force: true, recursive: true });
await mkdir(gateway, { recursive: true });
await cp("dist", gateway, { recursive: true });
await cp("demo", resolve(root, "demo"), { recursive: true });
await cp("examples/quickstart", resolve(root, "quickstart"), { recursive: true });
// A Pages project has a repository prefix; relative imports and URLs keep every
// resource within the published project without requiring a root Service Worker.
await writeFile(
  resolve(root, "index.html"),
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./demo/"><title>Gateway demo</title><a href="./demo/">Open the Gateway demo</a></html>',
);
