# Factories de dados para integração

Fábricas tipadas reduzem repetição e mantêm os testes legíveis. Derive os tipos do schema Drizzle.

## Padrão básico

```ts
// __tests__/integration/factories/psicologo.ts
import { runAsService } from '@/__tests__/integration/setup/rls';
import { psicologos, authUsers } from '@/lib/db/schema';
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

Pontos importantes:

- **`runAsService`** para bypassar RLS no setup (factories não testam RLS — outros testes testam).
- **Defaults realistas mas reconhecíveis** (`@hubrityp.test` deixa óbvio em logs).
- **`Override` derivado do `InferInsertModel`** mantém tipo sincronizado com o schema.
- **`returning()`** para devolver a linha completa, útil em assertions seguintes.

## Composição

```ts
// __tests__/integration/factories/agendamento.ts
import { createPsicologo } from './psicologo';
import { createPaciente } from './paciente';
import { runAsService } from '@/__tests__/integration/setup/rls';
import { agendamentos } from '@/lib/db/schema';

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

## Dados realistas (PT-BR)

Para CPF/CNPJ válidos, mantenha um pequeno banco de strings pré-calculadas em `__tests__/integration/factories/_fixtures.ts`:

```ts
export const CPFS_VALIDOS = [
  '529.982.247-25',
  '111.444.777-35',
  '298.687.760-30',
];
```

Não gere via libs como `faker` — testes ficam não-determinísticos sem `seed`. Se usar `faker`, **sempre** `faker.seed(<número>)` no `beforeEach`.

## Sequências e unicidade

Use `randomUUID()` para IDs e sufixos únicos em campos com `UNIQUE` (email, CPF). Nunca dependa de "primeiro registro tem id 1".

## Anti-padrões

- Factory que **mocka** algo. Factories tocam o DB real.
- Factory que **lê configuração de teste** (env, config). Receba via parâmetro.
- Factory que cria dados **demais** ("create um psicólogo com 10 pacientes e 50 consultas") — explicite no teste o que importa. Se vários testes precisam, faça uma factory composta nomeada (`createPsicologoComAgenda`).
- Factory que **espera estado anterior** ("esta factory falha se já existe um paciente"). Cada factory deve ser idempotente em relação a si mesma.
