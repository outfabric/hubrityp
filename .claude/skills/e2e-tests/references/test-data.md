# Dados de teste em E2E

Regra de ouro: **dados de teste via DB direto**, não pela UI. Cadastrar paciente pelo formulário em todos os testes que precisam de paciente desperdiça segundos por teste e amplia superfície de falha.

## Helper de DB no contexto do teste

```ts
// src/__tests__/e2e/seeded/helpers/db.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import * as schema from '@/shared/db/schema';
import { readSeedState } from '../setup/seed-state';

async function openDb() {
  // The container connection string was written to seed-state.json by
  // start-server.ts. We don't read process.env because Playwright workers
  // don't inherit env mutations from the webServer wrapper.
  const seed = await readSeedState();
  const client = postgres(seed.databaseUrl, { max: 1 });
  return { client, db: drizzle(client, { schema }) };
}

export async function truncateAllExceptSeed() {
  const { client, db } = await openDb();
  try {
    // Mantém auth.users (seed users) e psicologos (perfis seed); limpa transacionais.
    await db.execute(sql`
      TRUNCATE pacientes, agendamentos, cobrancas, prontuarios
        RESTART IDENTITY CASCADE;
    `);
  } finally {
    await client.end();
  }
}

export async function createPaciente(input: {
  psicologoId: string;
  nome?: string;
  cpf?: string;
}) {
  const { client, db } = await openDb();
  try {
    const [row] = await db
      .insert(schema.pacientes)
      .values({
        id: randomUUID(),
        psicologoId: input.psicologoId,
        nome: input.nome ?? 'Paciente Teste',
        cpf: input.cpf ?? '529.982.247-25',
      })
      .returning();
    return row;
  } finally {
    await client.end();
  }
}
```

## Isolamento entre testes

Use TRUNCATE no `beforeEach` do fixture base — mesmo padrão da skill `integration-tests`, mas **preserve seed users** (necessários para `storageState`).

```ts
// src/__tests__/e2e/seeded/fixtures/test-base.ts (continuação)
export const test = base.extend({
  page: async ({ page }, use) => {
    await truncateAllExceptSeed();
    await use(page);
  },
});
```

Trade-off: TRUNCATE adiciona ~10–30ms por teste. Para suite de 50 testes, ~1s total — irrelevante. Beneficio: cada teste começa do zero, sem dependência de ordem.

## Fixture para "psicólogo logado"

Combine seed user com helper de DB para uma fixture que entrega o `dr` pronto:

```ts
// src/__tests__/e2e/seeded/fixtures/test-base.ts
import { test as base, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { psicologos } from '@/shared/db/schema';
import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';
import { truncateAllExceptSeed } from '../helpers/db';

const SEED_PSICOLOGO_ID = '00000000-0000-4000-8000-000000000001';

type Fixtures = {
  dr: { id: string; nome: string };
};

export const test = base.extend<Fixtures>({
  storageState: STORAGE_STATE_PATH,

  dr: async ({}, use) => {
    const seed = await readSeedState();
    const client = postgres(seed.databaseUrl, { max: 1 });
    const db = drizzle(client);
    try {
      const [row] = await db.select().from(psicologos)
        .where(eq(psicologos.id, SEED_PSICOLOGO_ID));
      await use({ id: row.id, nome: row.nome });
    } finally {
      await client.end();
    }
  },

  page: async ({ page }, use) => {
    await truncateAllExceptSeed();
    await use(page);
  },
});

export { expect };
```

Spec consome:

```ts
test('agenda consulta', async ({ page, dr }) => {
  await createPaciente({ psicologoId: dr.id, nome: 'Maria' });
  // ...
});
```

## Dados realistas (CPF, CNPJ, datas)

Use os mesmos helpers do app (`@/shared/lib/cpf`, ou de um futuro `@/modules/pacientes/lib/cpf`) para gerar dados válidos. Não duplique lógica de geração no helper de teste — se a regra de validação muda, basta atualizar o helper do app.

Para casos onde precisa de pool de valores válidos pré-calculados:

```ts
// src/__tests__/e2e/seeded/helpers/fixtures.ts
export const CPFS_VALIDOS = ['529.982.247-25', '111.444.777-35', '298.687.760-30'];
```

## Uploads de arquivo

```ts
await page.getByLabel(/anexar receita/i)
  .setInputFiles('src/__tests__/e2e/seeded/fixtures/files/receita.pdf');
```

Mantenha arquivos pequenos (<100KB) em `src/__tests__/e2e/seeded/fixtures/files/`. Para PDFs grandes, gere com `pdfkit` no setup.

## Datas e timezone

O HubrityP opera em `America/Sao_Paulo`. Force timezone na fixture do `page` para evitar surpresas:

```ts
projects: [
  {
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      timezoneId: 'America/Sao_Paulo',
      locale: 'pt-BR',
    },
  },
],
```

Para "congelar o relógio" no navegador (ex.: testar agenda do dia), use `page.clock`:

```ts
await page.clock.install({ time: new Date('2026-05-01T09:00:00-03:00') });
await page.goto('/agenda');
// Toda chamada a Date.now() no navegador retorna esse instante.
```

`page.clock` afeta apenas o navegador, não o servidor Next.js. Para travar tempo no servidor, exporte uma função `agora()` no app que lê de uma flag controlada por env em test.

## Limpeza de Storage (Supabase Storage)

Em E2E, prefira **mockar uploads** via `page.route()` interceptando o endpoint de Storage. Se o teste precisa do arquivo persistido, use Supabase Storage local via `supabase start` (suíte real) — não tente subir MinIO via Testcontainers só para isso.

## Antipadrões

- Cadastrar paciente pela UI em cada teste de agendamento (lento, frágil).
- Reutilizar dados entre testes (`describe.serial` é code smell).
- Hardcode IDs de UUIDs específicos esperando que existam — gere e capture (exceção: o `SEED_PSICOLOGO_ID` é hardcoded por design, vive em `start-server.ts`).
- Snapshots de UI complexa por valor — mude por asserções de role/text.
- Esquecer de limpar dados entre testes esperando "ah, vai ser único" — vai ser exatamente até não ser.
- Ler `process.env.E2E_DATABASE_URL` no helper de teste — Playwright workers não herdam mutations do `webServer`. Use `readSeedState()`.
