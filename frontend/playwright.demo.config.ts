import { defineConfig, devices } from '@playwright/test';

/** Run against the built demo served by a static server; no API mocks or backend. */
export default defineConfig({
  testDir: './tests/demo',
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: process.env.STUDIO_DEMO_REPORT || 'test-results/demo-report.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.STUDIO_DEMO_URL || 'http://127.0.0.1:4186',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 10_000,
    launchOptions: process.env.STUDIO_DEMO_CHROMIUM ? { executablePath: process.env.STUDIO_DEMO_CHROMIUM } : {},
  },
});
