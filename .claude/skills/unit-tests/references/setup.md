# Setup do Vitest no Next.js + TypeScript

## Instalação

```bash
npm i -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom \
        @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- `@vitejs/plugin-react` resolve JSX e Fast Refresh para componentes React.
- `vite-tsconfig-paths` faz o alias `@/` do `tsconfig.json` funcionar no Vitest.
- `jsdom` é o DOM virtual usado por suítes de UI/hook.
- `@testing-library/jest-dom` adiciona matchers como `toBeInTheDocument`.

## `vitest.config.ts` recomendado

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',           // padrão; suítes de DOM sobrescrevem com diretiva no topo
    globals: false,                // importe `vi`, `describe`, `it`, `expect` explicitamente
    clearMocks: true,              // limpa histórico entre testes
    restoreMocks: true,            // restaura spies para implementação original
    unstubEnvs: true,
    unstubGlobals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['app/**', 'lib/**', 'components/**'],
      exclude: ['**/*.d.ts', '**/*.test.*', '**/types.ts', 'app/**/layout.tsx'],
      thresholds: { lines: 80, statements: 80, branches: 70, functions: 80 },
    },
  },
});
```

`globals: false` evita poluir o escopo global e força imports explícitos — combina com TypeScript strict e melhora rastreabilidade.

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

## Scripts no `package.json`

```json
{
  "scripts": {
    "test:unit": "vitest run --reporter=dot",
    "test:unit:watch": "vitest",
    "test:unit:coverage": "vitest run --coverage",
    "check": "npm run lint && npm run format && npm run typecheck && npm run test:unit"
  }
}
```

## Aliases (`tsconfig.json`)

Garanta o `paths` para que `vite-tsconfig-paths` os repasse ao Vitest:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  }
}
```

## Ambiente por arquivo

Padrão é `node` (ver config). Para suítes que precisam de DOM:

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
```

Para suítes que precisam de `happy-dom` (mais leve que jsdom):

```ts
// @vitest-environment happy-dom
```

## Variáveis de ambiente em testes

Crie `.env.test` com valores **fake mas válidos** (passam pelo schema Zod do módulo central de env). Ative com:

```ts
// vitest.config.ts → defineConfig({ test: { env: loadEnv('test', process.cwd(), '') } })
```

Nunca aponte `.env.test` para Supabase real — bloqueie URLs com prefixo `https://` no schema durante testes se necessário.

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
