# Vitest setup in Next.js + TypeScript

## Installation

```bash
npm i -D vitest @vitejs/plugin-react jsdom \
        @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- `@vitejs/plugin-react` resolves JSX and Fast Refresh for React components.
- `jsdom` is the virtual DOM used by UI/hook suites.
- `@testing-library/jest-dom` adds matchers like `toBeInTheDocument`.

> HubrityP does **not** use `vite-tsconfig-paths` — the `@/*` alias is declared directly in `resolve.alias` of `vitest.config.ts` (pointing to `src/`), with an explicit stub for `server-only`. See example below.

## Recommended `vitest.config.ts`

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
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
      // `server-only` throws on any require outside Next's bundler.
      // Inline so the alias below can stub it.
      deps: { inline: ['server-only'] },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/app/**', 'src/modules/**', 'src/shared/**'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.*',
        '**/types.ts',
        'src/app/**/layout.tsx',
      ],
      thresholds: { lines: 80, statements: 80, branches: 70, functions: 80 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      // No-op stub for `import 'server-only'` in modules under test.
      'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts'),
    },
  },
});
```

`globals: true` makes `describe`/`it`/`expect`/`vi` available without import (project choice). If you prefer explicit, switch to `false` and import from `vitest`.

## `vitest.setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();              // unmounts React tree between tests
  vi.useRealTimers();     // ensures reset if any test forgot
});
```

## `server-only` stub

```ts
// src/__tests__/stubs/server-only.ts
// Intentionally empty. The real package throws on any require outside
// Next's bundler; this stub allows testing modules with `import 'server-only'`.
export {};
```

## `package.json` scripts

```json
{
  "scripts": {
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:unit:coverage": "vitest run --coverage",
    "check": "npm run lint && npm run format:check && npm run typecheck"
  }
}
```

## Aliases (`tsconfig.json`)

The `@/*` alias points to `./src/*` (post-`reorganize-folder-structure`):

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

## Environment per file

`environmentMatchGlobs` resolves the environment automatically based on the suffix:

- `*.test.ts` → `node`
- `*.test.tsx` → `jsdom`

If you need to override punctually:

```ts
// @vitest-environment jsdom
```

## Environment variables in tests

For tests that validate `serverEnv`/`clientEnv` (Zod):

- Use `vi.stubEnv('NAME', 'value')` per test.
- `unstubEnvs: true` in config restores between tests.

Never point a test `.env` to real Supabase — block URLs with `https://` prefix in the schema during tests if needed.

## Husky / lint-staged integration

In `lint-staged`, add incremental execution:

```json
{
  "*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write",
    "vitest related --run --passWithNoTests"
  ]
}
```

`vitest related` runs only tests affected by the staged files — keeps pre-commit fast.

## Performance

- Use `pool: 'threads'` (default) for light I/O; `pool: 'forks'` if some global mock leaks between files.
- `isolate: true` (default) ensures fresh modules per file. Only disable if you measure regression and prove safety.
- Slow suites (>200ms): isolate, profile with `vitest --reporter=verbose --slowTestThreshold=100`.
