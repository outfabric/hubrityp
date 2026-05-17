# Testing Supabase RLS in integration

The fundamental rule of HubrityP is "a psychologist only sees data for their own patients". RLS is the boundary that guarantees this. Integration tests should **prove behavior**, not just the existence of the policy.

## How Supabase authorizes per user

In production, the Supabase JS client sends the JWT in the header. Postgres sets `request.jwt.claims` per session and the policy reads it:

```sql
CREATE POLICY "psicologo_le_seus_pacientes" ON pacientes
  FOR SELECT TO authenticated
  USING (psicologo_id = auth.uid());
```

`auth.uid()` is equivalent to `(current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid`.

In tests, we simulate this on the connection.

## `runAsUser` helper

```ts
// src/__tests__/integration/setup/rls.ts
import { sql } from 'drizzle-orm';
import { rawPool } from './db';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/shared/db/schema';

export async function runAsUser<T>(
  userId: string,
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
): Promise<T> {
  const client = await rawPool.connect();
  try {
    await client.query(`SET LOCAL ROLE authenticated;`);
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true);`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })]
    );
    const scoped = drizzle(client, { schema });
    return await fn(scoped);
  } finally {
    client.release();
  }
}

export async function runAsService<T>(
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
): Promise<T> {
  const client = await rawPool.connect();
  try {
    await client.query(`SET LOCAL ROLE postgres;`); // bypasses RLS
    const scoped = drizzle(client, { schema });
    return await fn(scoped);
  } finally {
    client.release();
  }
}
```

`SET LOCAL` confines the change to the current transaction; `set_config(..., true)` does the same for the claim. `client.release()` returns the clean connection to the pool.

## Mandatory cases per table with RLS

For each table with a policy scoped by psychologist, write at least:

1. **Owner reads**: `runAsUser(dr_a)` returns `dr_a`'s records.
2. **Non-owner does not read**: `runAsUser(dr_b)` returns `[]` (not an error).
3. **Non-owner does not write**: `runAsUser(dr_b)` insert on `dr_a`'s resource throws error `42501` (insufficient privilege) or violates a check.
4. **Anonymous is blocked**: call without JWT (role `anon`) returns `[]` or error.

These assertions are worth more than checking the policy SQL — they prove the **effect**.

## Example

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/__tests__/integration/setup/db';
import { runAsUser, runAsService, truncateAll } from '@/__tests__/integration/setup/rls';
import { pacientes } from '@/shared/db/schema';
import { createPsicologo } from '@/__tests__/integration/factories/psicologo';

describe('RLS pacientes', () => {
  beforeEach(() => truncateAll(db));

  it('isolates patients per psychologist', async () => {
    const dr_a = await createPsicologo();
    const dr_b = await createPsicologo();

    await runAsService(async (admin) => {
      await admin.insert(pacientes).values([
        { psicologoId: dr_a.id, nome: 'Maria', cpf: '529.982.247-25' },
        { psicologoId: dr_b.id, nome: 'João', cpf: '111.444.777-35' },
      ]);
    });

    const visivelParaA = await runAsUser(dr_a.id, (scoped) =>
      scoped.select().from(pacientes)
    );
    const visivelParaB = await runAsUser(dr_b.id, (scoped) =>
      scoped.select().from(pacientes)
    );

    expect(visivelParaA.map((p) => p.nome)).toEqual(['Maria']);
    expect(visivelParaB.map((p) => p.nome)).toEqual(['João']);
  });

  it('blocks cross writes', async () => {
    const dr_a = await createPsicologo();
    const dr_b = await createPsicologo();

    await expect(
      runAsUser(dr_b.id, (scoped) =>
        scoped.insert(pacientes).values({
          psicologoId: dr_a.id,            // tries to write into A's slot
          nome: 'X',
          cpf: '529.982.247-25',
        })
      )
    ).rejects.toThrow(/row-level security|42501/i);
  });
});
```

## Pitfalls

- **`SET ROLE` without `LOCAL` leaks** across operations on the same client. Always `SET LOCAL` inside a transaction or use a dedicated connection.
- **`auth.uid()` returns `NULL`** when claims are not set → policy denies everything. Good for the anonymous case, but make sure the helper actually sets it before calling.
- **Service client (postgres/superuser) bypasses RLS** — useful to prepare data, **never** use it in the path under test.
- **`BEFORE INSERT` triggers that set `psicologo_id = auth.uid()`** are a good practice that simplifies policies; test them explicitly.
- **The Supabase connection pooler (PgBouncer)** can mix sessions in production. Always use `SET LOCAL` (transaction-scoped) and never `SET SESSION`.

## Review checklist

- [ ] Every new table with RLS has at least the 4 cases above.
- [ ] Test uses the `authenticated` role, not superuser.
- [ ] `runAsService` appears **only** in fixtures/factories, never inside the `it`.
- [ ] The migration that creates the table includes `ENABLE ROW LEVEL SECURITY` (assertable with a query on `information_schema`).
