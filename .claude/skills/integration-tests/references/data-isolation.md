# Isolamento de dados entre testes

Container compartilhado precisa de uma estratégia para evitar contaminação entre testes. Três opções, em ordem de preferência:

## 1. TRUNCATE em `beforeEach` (default)

```ts
// src/__tests__/integration/setup/rls.ts
import { sql } from 'drizzle-orm';
import type { db as Db } from './db';

const TABELAS = [
  'agendamentos',
  'pacientes',
  'psicologos',
  'auth.users',
] as const;

export async function truncateAll(db: typeof Db) {
  await db.execute(
    sql.raw(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE;`)
  );
}
```

**Quando usar:** default. Simples, previsível, fácil de debugar.

**Trade-offs:** ~5–20ms por teste; requer manter a lista de tabelas.

**Dica:** gere a lista dinamicamente do `information_schema` se o esquema cresce muito:

```ts
const { rows } = await db.execute(sql`
  SELECT table_schema || '.' || table_name AS qname
  FROM information_schema.tables
  WHERE table_schema IN ('public', 'auth')
    AND table_type = 'BASE TABLE'
    AND table_name <> 'schema_migrations'
`);
```

## 2. Transação com rollback

```ts
beforeEach(async (ctx) => {
  ctx.tx = await db.transaction(async (tx) => tx, { isolationLevel: 'serializable' });
});
afterEach(async (ctx) => {
  await ctx.tx.rollback();
});
```

**Quando usar:** suítes muito grandes onde cada `TRUNCATE` virou gargalo.

**Trade-offs:**
- Código sob teste **deve** receber a tx injetada — não pode abrir nova conexão.
- Não funciona se a função sob teste usa `BEGIN/COMMIT` interno (ex.: `db.transaction()` aninhado vira savepoint, OK; mas `pg` em pool separado, NÃO).
- Inviável se a verificação precisa ler em **outra** conexão.

## 3. Schema/database por arquivo de teste

```ts
// global-setup cria; cada arquivo recebe um nome único
const schemaName = `test_${randomUUID().replace(/-/g, '')}`;
await db.execute(sql.raw(`CREATE SCHEMA ${schemaName};`));
// configurar search_path para esse schema
```

**Quando usar:** paralelismo agressivo (`maxForks: 8+`) + testes longos.

**Trade-offs:** complexidade alta, debug mais chato, custo de criação de schema.

## Sequências e dados de referência

Use `RESTART IDENTITY` no TRUNCATE para resetar `serial`/`bigserial`. Para tabelas seed (ex.: `tipos_consulta`), faça `INSERT` no `beforeEach` ou exclua do TRUNCATE com `EXCEPT`.

## Time-travel

Use `vi.useFakeTimers({ now: ... })` ou injete um `clock` provider. Não dependa de `now()` do Postgres em assertions — set explicitamente:

```ts
await db.insert(agendamentos).values({
  /* ... */ criadoEm: new Date('2026-05-01T10:00:00-03:00'),
});
```

## Paralelismo

Com `pool: 'forks'` cada arquivo roda em processo isolado, mas todos batem no **mesmo container**. Se o teste cria/lê em tabelas distintas, o paralelismo é seguro. Se compartilha tabela e usa TRUNCATE, **um teste pode truncar o estado de outro**. Soluções:

1. Limitar `maxForks: 1` para a suite (mais lento, sempre seguro). É o default no `vitest.integration.config.ts` do HubrityP via `fileParallelism: false`.
2. Usar schema-por-arquivo (opção 3 acima).
3. Marcar suítes que dividem tabela com `describe.sequential` (Vitest >= 1.4) — não resolve entre arquivos, só dentro.

**Recomendação prática:** começar com `fileParallelism: false` + TRUNCATE. Subir só se a suite ficar lenta o suficiente para justificar a complexidade.

## Limpeza de arquivos / Storage

Se a feature usa Supabase Storage, mocke o cliente de Storage no nível da fronteira (não suba MinIO no container). Storage é integração-de-integração — fora do escopo unitário e da maioria dos testes de integração.
