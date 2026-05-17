# Data factories for integration

Typed factories reduce repetition and keep tests readable. Derive types from the Drizzle schema.

## Basic pattern

```ts
// src/__tests__/integration/factories/psicologo.ts
import { runAsService } from '@/__tests__/integration/setup/rls';
import { psicologos, authUsers } from '@/shared/db/schema';
import type { InferInsertModel } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

type Override = Partial<InferInsertModel<typeof psicologos>>;

export async function createPsicologo(overrides: Override = {}) {
  return runAsService(async (db) => {
    const id = overrides.id ?? randomUUID();
    await db.insert(authUsers).values({
      id,
      email: `dr.${id.slice(0, 8)}@hubrityp.test`,
    });
    const [row] = await db
      .insert(psicologos)
      .values({
        id,
        nome: 'Dr(a). Teste',
        crp: '06/123456',
        ...overrides,
      })
      .returning();
    return row;
  });
}
```

Key points:

- **`runAsService`** to bypass RLS in setup (factories do not test RLS — other tests do).
- **Realistic but recognizable defaults** (`@hubrityp.test` makes it obvious in logs).
- **`Override` derived from `InferInsertModel`** keeps the type in sync with the schema.
- **`returning()`** to return the full row, useful in subsequent assertions.

> **Schema type**: for tables that already export a `New<X>` (e.g., `NewHealthPing` in `@/shared/db/schema/health/tables`), use the direct alias instead of re-deriving with `InferInsertModel` — it's more readable and types against exactly what the app inserts.

## Composition

```ts
// src/__tests__/integration/factories/agendamento.ts
import { createPsicologo } from './psicologo';
import { createPaciente } from './paciente';
import { runAsService } from '@/__tests__/integration/setup/rls';
import { agendamentos } from '@/shared/db/schema';

export async function createAgendamento(overrides: Partial<{
  psicologoId: string;
  pacienteId: string;
  horario: Date;
}> = {}) {
  const psicologoId = overrides.psicologoId ?? (await createPsicologo()).id;
  const pacienteId =
    overrides.pacienteId ?? (await createPaciente({ psicologoId })).id;

  return runAsService(async (db) => {
    const [row] = await db
      .insert(agendamentos)
      .values({
        psicologoId,
        pacienteId,
        horario: overrides.horario ?? new Date('2026-06-01T14:00:00-03:00'),
        status: 'agendado',
      })
      .returning();
    return row;
  });
}
```

## Realistic data (PT-BR)

For valid CPF/CNPJ, keep a small bank of pre-calculated strings in `src/__tests__/integration/factories/_fixtures.ts`:

```ts
export const CPFS_VALIDOS = [
  '529.982.247-25',
  '111.444.777-35',
  '298.687.760-30',
];
```

Do not generate via libs like `faker` — tests become non-deterministic without `seed`. If you use `faker`, **always** `faker.seed(<number>)` in `beforeEach`.

## Sequences and uniqueness

Use `randomUUID()` for IDs and unique suffixes in fields with `UNIQUE` (email, CPF). Never depend on "the first record has id 1".

## Antipatterns

- A factory that **mocks** something. Factories touch the real DB.
- A factory that **reads test configuration** (env, config). Receive it via parameter.
- A factory that creates **too much** data ("create a psychologist with 10 patients and 50 appointments") — make explicit in the test what matters. If several tests need it, build a named composite factory (`createPsicologoComAgenda`).
- A factory that **expects prior state** ("this factory fails if a patient already exists"). Each factory must be idempotent with respect to itself.
