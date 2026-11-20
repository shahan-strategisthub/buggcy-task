import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.TEST_URL ?? 'http://127.0.0.1:3000',
    channel: process.env.TEST_BROWSER_CHANNEL,
    httpCredentials: process.env.TEST_PASSWORD ? { username: 'reviewer', password: process.env.TEST_PASSWORD } : undefined,
    trace: 'retain-on-failure',
  },
});
