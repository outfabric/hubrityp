# Autenticação reutilizável com `storageState`

Login via UI em todo teste é a maior fonte de lentidão e flakiness. A receita: autenticar **uma vez** em um setup project, salvar cookies/localStorage em arquivo, reutilizar em todos os testes que precisarem.

## Fluxo geral (suíte seeded)

1. `webServer.command` → `src/__tests__/e2e/seeded/setup/start-server.ts` boota Postgres compartilhado, aplica migrations, inicia mock GoTrue e spawn `next start`.
2. Playwright `globalSetup` (`src/__tests__/e2e/seeded/setup/global-setup.ts`) seed os usuários em `auth.users` + dados base.
3. Setup project (`src/__tests__/e2e/seeded/setup/auth.setup.ts`) faz signin programático contra o mock GoTrue → grava `storageState` em `src/__tests__/e2e/seeded/setup/.auth/state.json`.
4. Testes opt-in via `test.use({ storageState: STORAGE_STATE_PATH })`. Cada teste já abre logado em <100ms.

## Signin programático contra mock GoTrue

Em E2E seeded a auth é simulada por:

1. Mock GoTrue HTTP server (em `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`) ouvindo em `127.0.0.1:54321` (porta hardcoded — ver "Notas críticas" no SKILL.md).
2. `start-server.ts` constrói um JWT válido (HS256, payload com `sub`, `email`, `aud`, `role`, `exp` no futuro) e configura o mock pra retornar esse mesmo token + user em `GET /auth/v1/user`.
3. Inserção do user em `auth.users` (com o mesmo `sub` UUID) feita pelo `globalSetup`.
4. `auth.setup.ts` usa `@supabase/ssr` para chamar `supabase.auth.setSession({ access_token, refresh_token })`. A lib chama `setAll` com os cookies no formato esperado; capturamos e gravamos no `storageState`.

```ts
// src/__tests__/e2e/seeded/setup/auth.setup.ts
import { writeFile } from 'node:fs/promises';
import { test as setup } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { readSeedState, STORAGE_STATE_PATH } from './seed-state';

setup('write simulated auth state', async () => {
  const seed = await readSeedState();
  const captured: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(seed.supabaseUrl, 'e2e-anon-key', {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => { captured.push(...cookiesToSet); },
    },
  });

  const { error } = await supabase.auth.setSession({
    access_token: seed.accessToken,
    refresh_token: seed.refreshToken,
  });
  if (error) throw new Error(`auth.setup: ${error.message}`);

  const cookies = captured.map((c) => ({
    name: c.name,
    value: c.value,
    domain: 'localhost',
    path: c.options.path ?? '/',
    expires: Math.floor(Date.now() / 1000) + (c.options.maxAge ?? 86_400),
    httpOnly: c.options.httpOnly ?? false,
    secure: false,            // baseURL é http (sem TLS); cookie Secure seria descartado
    sameSite: 'Lax' as const,
  }));

  await writeFile(STORAGE_STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));
});
```

A vantagem de delegar pra `@supabase/ssr` em vez de hand-rolling o cookie: o nome (`sb-<projectRef>-auth-token`), encoding (`base64-` + base64url) e estratégia de chunking ficam corretos sem que o teste precise saber.

## Suíte real (`@auth-real`)

A suíte real opera contra o GoTrue do `supabase start` e não usa `storageState` global. Cada spec faz o login via a UI ou via API (`supabase.auth.signInWithPassword`), valida o caminho real ponta-a-ponta, e o cookie real do GoTrue carrega o estado para o resto do fluxo.

`src/__tests__/e2e/real/setup/credentials.ts` mantém os emails/passwords dos seed users que o `globalSetup` cria via `supabase.auth.admin.createUser` (usando o `SERVICE_ROLE_KEY` lido no config-load).

## Múltiplos perfis de usuário (suíte seeded)

Se a suite precisa de "psicólogo A" e "psicólogo B" (ex.: testar isolamento), crie um setup project para cada e múltiplos `storageState`:

```ts
// playwright.seeded.config.ts
projects: [
  { name: 'setup-dr-a', testMatch: /auth-dr-a\.setup\.ts/ },
  { name: 'setup-dr-b', testMatch: /auth-dr-b\.setup\.ts/ },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },                  // sem storageState aqui
    dependencies: ['setup-dr-a', 'setup-dr-b'],
  },
];
```

Cada teste opt-in para o estado que precisa:

```ts
import { STORAGE_STATE_PATH_A, STORAGE_STATE_PATH_B } from './setup/seed-state';

test.describe('isolamento por psicólogo', () => {
  test.use({ storageState: STORAGE_STATE_PATH_A });
  test('dr_a vê só seus pacientes', /* ... */);
});

test('dr_b não vê dados de dr_a', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE_PATH_B });
  const page = await ctx.newPage();
  // ...
});
```

## Worker-scoped (acessos paralelos isolados)

Para suítes onde cada worker precisa de **conta única** (ex.: testar criação de conta com mutações isoladas), use fixture worker-scoped que cria conta on-demand. Detalhes em [docs do Playwright sobre auth](https://playwright.dev/docs/auth#authenticate-with-api-request).

No HubrityP, o caminho default é **um seed user compartilhado** — mais rápido e suficiente para 90% dos fluxos. Múltiplos perfis só onde houver assertion de isolamento entre eles.

## Logout / sessão expirada

Para testar fluxo de logout ou token expirado, **não** mexa no `storageState` global. Crie contexto novo:

```ts
test('redireciona para /login quando token expira', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
```

## Checklist

- [ ] `auth.setup.ts` é idempotente (insert do seed user usa `ON CONFLICT DO NOTHING`).
- [ ] `src/__tests__/e2e/seeded/setup/.auth/` está no `.gitignore`.
- [ ] Cookies escritos com `domain: 'localhost'` + `secure: false` (baseURL HTTP em dev/CI).
- [ ] Seed user nunca é alterado por testes (não delete em TRUNCATE).
- [ ] Logout/expiração testados com `storageState: undefined`, não tocando o arquivo global.
- [ ] Constantes `STORAGE_STATE_PATH` etc. importadas de `./setup/seed-state.ts`, não hardcoded.
