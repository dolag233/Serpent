import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  preserveOutput: 'always',
  use: {
    trace: 'retain-on-failure',
  },
});
