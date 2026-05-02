# Autenticação reutilizável com `storageState`

Login via UI em todo teste é a maior fonte de lentidão e flakiness. A receita: autenticar **uma vez** em um setup project, salvar cookies/localStorage em arquivo, reutilizar em todos os testes.

## Fluxo geral

1. `globalSetup` sobe container e aplica migrations.
2. Setup project (`auth.setup.ts`) cria seed user no DB e simula login → grava `storageState`.
3. Project `chromium` declara `dependencies: ['setup']` e `use.storageState`. Cada teste já abre logado.

## Signin programático contra Supabase Auth (simulado)

Em E2E com Testcontainers Postgres-only (sem gotrue), a auth é simulada por:

1. Inserir o usuário em `auth.users` com `id` conhecido.
2. Gerar um JWT válido com a mesma `JWT_SECRET` que o app usa em modo test.
3. Setar o cookie `sb-<ref>-auth-token` que `@supabase/ssr` lê no servidor.

```ts
// e2e/auth.setup.ts
import { test as setup } from '@playwright/test';
import { SignJWT } from 'jose';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authUsers, psicologos } from '@/lib/db/schema';

const SEED_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'dr.seed@hubrityp.test',
};

setup('autentica psicólogo seed', async ({ page, baseURL }) => {
  const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
  const db = drizzle(pool);

  await db
    .insert(authUsers)
    .values({ id: SEED_USER.id, email: SEED_USER.email })
    .onConflictDoNothing();
  await db
    .insert(psicologos)
    .values({ id: SEED_USER.id, nome: 'Dr. Seed', crp: '06/000000' })
    .onConflictDoNothing();
  await pool.end();

  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
  const token = await new SignJWT({
    sub: SEED_USER.id,
    email: SEED_USER.email,
    role: 'authenticated',
    aud: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret);

  const cookieValue = JSON.stringify({
    access_token: token,
    token_type: 'bearer',
    user: { id: SEED_USER.id, email: SEED_USER.email },
  });

  await page.context().addCookies([
    {
      name: `sb-${process.env.SUPABASE_PROJECT_REF}-auth-token`,
      value: encodeURIComponent(cookieValue),
      url: baseURL!,
    },
  ]);

  await page.goto('/dashboard');
  await page.waitForURL(/\/dashboard/);   // confirma que ficou logado

  await page.context().storageState({ path: 'e2e/playwright/.auth/user.json' });
});
```

O nome exato do cookie depende da configuração do `@supabase/ssr` — verifique no app a função que cria o cliente server-side.

## Múltiplos perfis de usuário

Se a suite precisa de "psicólogo A" e "psicólogo B" (ex.: testar isolamento), crie um setup project para cada e múltiplos `storageState`:

```ts
// playwright.config.ts
projects: [
  { name: 'setup-dr-a', testMatch: /auth-dr-a\.setup\.ts/ },
  { name: 'setup-dr-b', testMatch: /auth-dr-b\.setup\.ts/ },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], storageState: 'e2e/playwright/.auth/dr-a.json' },
    dependencies: ['setup-dr-a', 'setup-dr-b'],
  },
];
```

Dentro de um teste específico, troque para o outro estado:

```ts
test('dr-b não vê dados do dr-a', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: 'e2e/playwright/.auth/dr-b.json' });
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

- [ ] `auth.setup.ts` é idempotente (`onConflictDoNothing`).
- [ ] `playwright/.auth/` está no `.gitignore`.
- [ ] `SUPABASE_JWT_SECRET` é o mesmo no app e no setup (env de teste).
- [ ] Seed user nunca é alterado por testes (não delete em TRUNCATE).
- [ ] Logout/expiração testados com `storageState: undefined`, não tocando o arquivo global.
