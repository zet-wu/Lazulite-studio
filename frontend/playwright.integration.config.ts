import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  outputDir: './integration-results',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: '../server/.venv/bin/python -m uvicorn server.tests.browser_fixture:create_browser_app --factory --app-dir .. --host 127.0.0.1 --port 8015',
      url: 'http://127.0.0.1:8015/api/v1/session',
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
      env: { STUDIO_API_TARGET: 'http://127.0.0.1:8015', VITE_ENABLE_MOCKS: 'false' },
      url: 'http://127.0.0.1:5175/projects',
      timeout: 30_000,
    },
  ],
});
