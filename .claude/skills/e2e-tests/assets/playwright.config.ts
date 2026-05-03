// Reference template for a Playwright config wired to Testcontainers + a
// programmatic-auth setup project. The HubrityP repo splits this into TWO
// configs at the repo root (matched to the two e2e suites):
//
//   - playwright.seeded.config.ts → testDir: ./src/__tests__/e2e/seeded
//   - playwright.real.config.ts   → testDir: ./src/__tests__/e2e/real
//
// Use this asset as a starting point, then specialise per suite. Read
// `references/setup.md` for the actual shape used by the project.

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE = resolve(
  __dirname,
  '../../src/__tests__/e2e/seeded/setup/.auth/state.json'
);
const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: './src/__tests__/e2e/seeded',
  testMatch: ['**/*.spec.ts', '**/*.setup.ts'],
  outputDir: 'test-results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ...(process.env.CI ? ([['github']] as const) : []),
  ],
  globalSetup: './src/__tests__/e2e/seeded/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/seeded/setup/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // The wrapper boots Testcontainers Postgres + mock GoTrue and only then
    // spawns `next start`. Doing the boot inside `globalSetup` would not
    // work — Playwright starts `webServer` before `globalSetup`.
    command: 'npx tsx src/__tests__/e2e/seeded/setup/start-server.ts',
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
