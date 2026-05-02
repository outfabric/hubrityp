import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['**/*.test.ts', 'node'],
    ],
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules',
      '.next',
      'e2e',
      '__tests__/integration',
      'coverage',
      '.claude',
      'openspec',
      '.temp',
    ],
    server: {
      deps: {
        // `server-only` always throws when required outside Next's bundler.
        // Inline it so we can stub it via the alias below in unit tests.
        inline: ['server-only'],
      },
    },
  },
  resolve: {
    alias: {
      '@': rootDir,
      // No-op stub: tests can import modules guarded with `import 'server-only'`.
      'server-only': path.resolve(rootDir, 'test/stubs/server-only.ts'),
    },
  },
});
