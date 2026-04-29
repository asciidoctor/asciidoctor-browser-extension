import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'spec/browser',
  testMatch: '**/*.spec.js',
  use: {
    headless: true,
  },
  webServer: {
    command: 'node tasks/server.js',
    url: 'http://localhost:5678/spec/browser/test-page.html',
    reuseExistingServer: !process.env.CI,
  },
})