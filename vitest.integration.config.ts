import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/integration/**/*.int.test.ts'],
    exclude: [
      'node_modules',
      '.next',
      'src/__tests__/e2e',
      'coverage',
      '.claude',
      'openspec',
      '.temp',
    ],
    globalSetup: ['./src/__tests__/integration/setup/global-setup.ts'],
    // Boot of Testcontainers Postgres + migrations can take ~30s on the cold
    // path; keep this generous so the suite never flakes on first run.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share a single Postgres container; keep them serial
    // to avoid intra-test cross-talk (each test runs inside its own
    // transaction via runAsUser/runAsService, but parallel suites can still
    // race on the same connection pool).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      // No-op the `server-only` package — see vitest.config.ts for context.
      'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts'),
    },
  },
});
