import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/performance', outputDir: './performance-results', workers: 1, timeout: 420_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5176', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: '../server/.venv/bin/python -m uvicorn server.tests.performance_fixture:create_performance_app --factory --app-dir .. --host 127.0.0.1 --port 8016', url: 'http://127.0.0.1:8016/api/v1/session', timeout: 60_000 },
    { command: './node_modules/.bin/vite preview --host 127.0.0.1 --port 5176 --strictPort', env: { STUDIO_API_TARGET: 'http://127.0.0.1:8016' }, url: 'http://127.0.0.1:5176/projects', timeout: 30_000 },
  ],
});
