import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'spec/browser',
  testMatch: '**/*.spec.js',
  use: {
    headless: true,
  },
})