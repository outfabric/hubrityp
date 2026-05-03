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
    include: ['src/__tests__/unit/**/*.test.ts', 'src/__tests__/unit/**/*.test.tsx'],
    exclude: [
      'node_modules',
      '.next',
      'src/__tests__/e2e',
      'src/__tests__/integration',
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
      // All source now lives under `src/`, so `@/*` resolves there directly.
      // The transitional `customResolver` that probed both `src/` and the
      // repo root has been removed (see openspec/changes/reorganize-folder-structure).
      '@': path.resolve(rootDir, 'src'),
      // No-op stub: tests can import modules guarded with `import 'server-only'`.
      'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts'),
    },
  },
});
