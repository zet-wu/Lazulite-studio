import { defineConfig } from '@playwright/test';
import performance from './playwright.performance.config';

export default defineConfig({ ...performance, testDir: './tests/manual', outputDir: './performance-results/manual' });
