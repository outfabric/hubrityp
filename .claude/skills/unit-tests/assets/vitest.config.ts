import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // jsdom for component/hook tests; node for everything else.
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['**/*.test.ts', 'node'],
    ],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/__tests__/unit/**/*.test.ts',
      'src/__tests__/unit/**/*.test.tsx',
    ],
    exclude: [
      'node_modules',
      '.next',
      'src/__tests__/integration',
      'src/__tests__/e2e',
      'coverage',
    ],
    server: {
      // `server-only` always throws when required outside Next's bundler.
      // Inline it so we can stub it via the alias below in unit tests.
      deps: { inline: ['server-only'] },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/app/**', 'src/modules/**', 'src/shared/**'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.*',
        '**/*.spec.*',
        '**/types.ts',
        'src/app/**/layout.tsx',
        'src/app/**/loading.tsx',
        'src/app/**/error.tsx',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 70,
        functions: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      // No-op stub: tests can import modules guarded with `import 'server-only'`.
      'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts'),
    },
  },
});
