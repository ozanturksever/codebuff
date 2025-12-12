import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './flows',
  fullyParallel: false, // Run sequentially - each test needs isolated infra
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 3 : 0, // Retry for OAuth flakiness
  workers: 1, // Single worker - tests share heavy infrastructure
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 180000, // 3 minutes per test - OAuth can be slow
  expect: {
    timeout: 30000, // 30 seconds for assertions
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
