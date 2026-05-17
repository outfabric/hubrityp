# Test data in E2E

Golden rule: **test data via direct DB**, not via UI. Registering a patient via the form in every test that needs one wastes seconds per test and widens the failure surface.

## DB helper inside the test context

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
    // Keeps auth.users (seed users) and psicologos (seed profiles); clears transactional data.
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

## Isolation between tests

Use TRUNCATE in the base fixture's `beforeEach` — same pattern as the `integration-tests` skill, but **preserve seed users** (required for `storageState`).

```ts
// src/__tests__/e2e/seeded/fixtures/test-base.ts (continued)
export const test = base.extend({
  page: async ({ page }, use) => {
    await truncateAllExceptSeed();
    await use(page);
  },
});
```

Trade-off: TRUNCATE adds ~10–30ms per test. For a 50-test suite, ~1s total — negligible. Benefit: each test starts from scratch, with no order dependency.

## Fixture for "logged-in psychologist"

Combine the seed user with the DB helper for a fixture that delivers a ready `dr`:

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

Spec consumes:

```ts
test('schedules a consultation', async ({ page, dr }) => {
  await createPaciente({ psicologoId: dr.id, nome: 'Maria' });
  // ...
});
```

## Realistic data (CPF, CNPJ, dates)

Use the same app helpers (`@/shared/lib/cpf`, or a future `@/modules/pacientes/lib/cpf`) to generate valid data. Do not duplicate generation logic in the test helper — if the validation rule changes, you only have to update the app helper.

For cases where you need a pool of pre-computed valid values:

```ts
// src/__tests__/e2e/seeded/helpers/fixtures.ts
export const CPFS_VALIDOS = ['529.982.247-25', '111.444.777-35', '298.687.760-30'];
```

## File uploads

```ts
await page.getByLabel(/anexar receita/i)
  .setInputFiles('src/__tests__/e2e/seeded/fixtures/files/receita.pdf');
```

Keep files small (<100KB) in `src/__tests__/e2e/seeded/fixtures/files/`. For large PDFs, generate them with `pdfkit` at setup.

## Dates and timezone

HubrityP operates in `America/Sao_Paulo`. Force the timezone in the `page` fixture to avoid surprises:

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

To "freeze the clock" in the browser (e.g., test the day's agenda), use `page.clock`:

```ts
await page.clock.install({ time: new Date('2026-05-01T09:00:00-03:00') });
await page.goto('/agenda');
// Every call to Date.now() in the browser returns that instant.
```

`page.clock` only affects the browser, not the Next.js server. To freeze time on the server, export an `agora()` function in the app that reads from an env-controlled flag in test.

## Storage cleanup (Supabase Storage)

In E2E, prefer to **mock uploads** via `page.route()` intercepting the Storage endpoint. If the test needs the file persisted, use local Supabase Storage via `supabase start` (real suite) — do not try to spin up MinIO via Testcontainers just for that.

## Antipatterns

- Registering a patient via UI in every scheduling test (slow, fragile).
- Reusing data between tests (`describe.serial` is a code smell).
- Hardcoding specific UUIDs expecting them to exist — generate and capture (exception: `SEED_PSICOLOGO_ID` is hardcoded by design, lives in `start-server.ts`).
- Snapshotting complex UI by value — switch to role/text assertions.
- Forgetting to clean data between tests expecting "ah, it will be unique" — it will, right up until it isn't.
- Reading `process.env.E2E_DATABASE_URL` in the test helper — Playwright workers do not inherit mutations from the `webServer`. Use `readSeedState()`.
