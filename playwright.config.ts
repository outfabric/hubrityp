import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Match both `*.spec.ts` (the actual tests) and `auth.setup.ts` (the
  // setup project below). The setup project narrows further via
  // `testMatch` so we never run `*.spec.ts` files inside it.
  testMatch: ['**/*.spec.ts', '**/*.setup.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    // Setup project: writes the simulated `storageState` JSON consumed by
    // the @auth tests. Runs once per Playwright invocation; the chromium
    // project below depends on it so the state file is guaranteed to
    // exist before any test that loads it.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // The webServer plugin is started by Playwright BEFORE `globalSetup`
    // runs (see Playwright's `runner/tasks.ts`). We therefore boot the
    // Postgres testcontainer + mock GoTrue inside the wrapper script and
    // hand off to `next start` with the resolved env, instead of trying to
    // wire dynamic values through `webServer.env` (which is captured at
    // config-load time).
    command: 'npx tsx e2e/start-server.ts',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
