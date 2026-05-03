import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    globalSetup: ['./src/__tests__/integration/setup/global-setup.ts'],
    setupFiles: ['./src/__tests__/integration/setup/setup.ts'],
    include: ['src/__tests__/integration/**/*.int.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      'src/__tests__/e2e/**',
      '**/dist/**',
    ],
    pool: 'forks',
    poolOptions: { forks: { singleFork: false, maxForks: 1 } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    sequence: { hooks: 'list' },
  },
});
