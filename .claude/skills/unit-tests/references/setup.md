# Setup do Vitest no Next.js + TypeScript

## Instalação

```bash
npm i -D vitest @vitejs/plugin-react jsdom \
        @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- `@vitejs/plugin-react` resolve JSX e Fast Refresh para componentes React.
- `jsdom` é o DOM virtual usado por suítes de UI/hook.
- `@testing-library/jest-dom` adiciona matchers como `toBeInTheDocument`.

> O HubrityP **não** usa `vite-tsconfig-paths` — o alias `@/*` é declarado direto no `resolve.alias` do `vitest.config.ts` (apontando para `src/`), com um stub explícito de `server-only`. Veja exemplo abaixo.

## `vitest.config.ts` recomendado

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
      // `server-only` lança em qualquer require fora do bundler do Next.
      // Inline para que o alias abaixo possa stubá-lo.
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
      // No-op stub para `import 'server-only'` em módulos sob teste.
      'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts'),
    },
  },
});
```

`globals: true` deixa `describe`/`it`/`expect`/`vi` disponíveis sem import (escolha do projeto). Se preferir explicitar, troque para `false` e importe de `vitest`.

## `vitest.setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();              // desmonta árvore React entre testes
  vi.useRealTimers();     // garante reset se algum teste esqueceu
});
```

## Stub de `server-only`

```ts
// src/__tests__/stubs/server-only.ts
// Vazio de propósito. O pacote real lança em qualquer require fora do
// bundler do Next; este stub permite testar módulos com `import 'server-only'`.
export {};
```

## Scripts no `package.json`

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

O alias `@/*` aponta para `./src/*` (post-`reorganize-folder-structure`):

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

## Ambiente por arquivo

O `environmentMatchGlobs` resolve o ambiente automaticamente baseado no sufixo:

- `*.test.ts` → `node`
- `*.test.tsx` → `jsdom`

Se precisar sobrescrever pontualmente:

```ts
// @vitest-environment jsdom
```

## Variáveis de ambiente em testes

Para testes que validam `serverEnv`/`clientEnv` (Zod):

- Use `vi.stubEnv('NAME', 'value')` por teste.
- `unstubEnvs: true` no config restaura entre testes.

Nunca aponte uma `.env` de teste para Supabase real — bloqueie URLs com prefixo `https://` no schema durante testes se necessário.

## Integração com Husky / lint-staged

No `lint-staged`, adicione execução incremental:

```json
{
  "*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write",
    "vitest related --run --passWithNoTests"
  ]
}
```

`vitest related` roda apenas testes afetados pelos arquivos staged — mantém o pre-commit rápido.

## Performance

- Use `pool: 'threads'` (padrão) para I/O leve; `pool: 'forks'` se algum mock global vazar entre arquivos.
- `isolate: true` (padrão) garante módulos frescos por arquivo. Só desabilite se medir regressão e provar segurança.
- Suítes lentas (>200ms): isole, perfile com `vitest --reporter=verbose --slowTestThreshold=100`.
