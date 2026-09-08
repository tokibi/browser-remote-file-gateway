import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4174',
  },
  webServer: {
    command: 'node test/server.mjs',
    url: 'http://127.0.0.1:4174/remote-file-gateway/generic.html',
    reuseExistingServer: false,
    timeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
