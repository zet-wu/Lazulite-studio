import { defineConfig, devices } from '@playwright/test';

// Opt-in: run against an already started isolated copy, never a user's live project.
export default defineConfig({
  testDir: './tests/performance', testMatch: 'vocal-phase2.spec.ts',
  outputDir: './follow-results', workers: 1, timeout: 600_000, reporter: 'list',
  use: {baseURL:process.env.STUDIO_FOLLOW_URL, ...devices['Desktop Chrome'], viewport:{width:1440,height:900}},
});
