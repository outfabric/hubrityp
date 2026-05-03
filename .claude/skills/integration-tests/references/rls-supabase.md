# Testando RLS do Supabase em integração

A regra fundamental do HubrityP é "psicólogo só vê dados dos próprios pacientes". RLS é a fronteira que garante isso. Testes de integração devem **provar comportamento**, não apenas existência da policy.

## Como o Supabase autoriza por usuário

Em produção, o cliente JS do Supabase envia o JWT no header. O Postgres seta `request.jwt.claims` por sessão e a policy lê:

```sql
CREATE POLICY "psicologo_le_seus_pacientes" ON pacientes
  FOR SELECT TO authenticated
  USING (psicologo_id = auth.uid());
```

`auth.uid()` é equivalente a `(current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid`.

Em teste, simulamos isso na conexão.

## Helper `runAsUser`

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
    await client.query(`SET LOCAL ROLE postgres;`); // bypassa RLS
    const scoped = drizzle(client, { schema });
    return await fn(scoped);
  } finally {
    client.release();
  }
}
```

`SET LOCAL` confina a mudança à transação atual; `set_config(..., true)` faz o mesmo para o claim. `client.release()` devolve a conexão limpa ao pool.

## Casos obrigatórios por tabela com RLS

Para cada tabela com policy escopada por psicólogo, escreva pelo menos:

1. **Dono lê**: `runAsUser(dr_a)` retorna registros de `dr_a`.
2. **Não-dono não lê**: `runAsUser(dr_b)` retorna `[]` (não erro).
3. **Não-dono não escreve**: `runAsUser(dr_b)` insert em recurso de `dr_a` lança erro `42501` (insufficient privilege) ou viola check.
4. **Anônimo é bloqueado**: chamada sem JWT (role `anon`) retorna `[]` ou erro.

Essas asserções valem mais que checar SQL da policy — elas provam o **efeito**.

## Exemplo

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/__tests__/integration/setup/db';
import { runAsUser, runAsService, truncateAll } from '@/__tests__/integration/setup/rls';
import { pacientes } from '@/shared/db/schema';
import { createPsicologo } from '@/__tests__/integration/factories/psicologo';

describe('RLS pacientes', () => {
  beforeEach(() => truncateAll(db));

  it('isola pacientes por psicólogo', async () => {
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

  it('bloqueia escrita cruzada', async () => {
    const dr_a = await createPsicologo();
    const dr_b = await createPsicologo();

    await expect(
      runAsUser(dr_b.id, (scoped) =>
        scoped.insert(pacientes).values({
          psicologoId: dr_a.id,            // tenta escrever no slot do A
          nome: 'X',
          cpf: '529.982.247-25',
        })
      )
    ).rejects.toThrow(/row-level security|42501/i);
  });
});
```

## Pitfalls

- **`SET ROLE` sem `LOCAL` vaza** entre operações no mesmo cliente. Sempre `SET LOCAL` dentro de transação ou usar conexão dedicada.
- **`auth.uid()` retorna `NULL`** quando claims não estão setados → policy nega tudo. Bom para o caso anônimo, mas certifique-se que o helper realmente seta antes de chamar.
- **Service client (postgres/superuser) bypassa RLS** — útil para preparar dados, **nunca** o use no caminho sob teste.
- **Triggers `BEFORE INSERT` que setam `psicologo_id = auth.uid()`** são uma boa prática que simplifica policies; teste-os explicitamente.
- **Connection pooler do Supabase (PgBouncer)** pode misturar sessões em produção. Use sempre `SET LOCAL` (transaction-scoped) e nunca `SET SESSION`.

## Checklist de revisão

- [ ] Toda nova tabela com RLS tem ao menos os 4 casos acima.
- [ ] Teste usa role `authenticated`, não superuser.
- [ ] `runAsService` aparece **só** em fixtures/factories, nunca dentro do `it`.
- [ ] Migration que cria a tabela inclui `ENABLE ROW LEVEL SECURITY` (assertível com query no `information_schema`).
