import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import * as schema from '@/shared/db/schema';
import { readSeedState } from '../seeded/setup/seed-state';

// E2E DB helpers connect to the Postgres container booted by start-server.ts.
// We read the connection string from `seed-state.json` instead of a process
// env var because Playwright workers do not inherit env mutations from the
// webServer wrapper.
async function openDb() {
  const seed = await readSeedState();
  const client = postgres(seed.databaseUrl, { max: 5 });
  return { client, db: drizzle(client, { schema }) };
}

const TABELAS_TRANSACIONAIS = [
  'agendamentos',
  'cobrancas',
  'prontuarios',
  'pacientes',
];

export async function truncateAllExceptSeed() {
  const { client, db } = await openDb();
  try {
    await db.execute(
      sql.raw(
        `TRUNCATE ${TABELAS_TRANSACIONAIS.join(', ')} RESTART IDENTITY CASCADE;`
      )
    );
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

export async function createAgendamento(input: {
  psicologoId: string;
  pacienteId: string;
  horario?: Date;
}) {
  const { client, db } = await openDb();
  try {
    const [row] = await db
      .insert(schema.agendamentos)
      .values({
        id: randomUUID(),
        psicologoId: input.psicologoId,
        pacienteId: input.pacienteId,
        horario: input.horario ?? new Date('2026-06-01T14:00:00-03:00'),
        status: 'agendado',
      })
      .returning();
    return row;
  } finally {
    await client.end();
  }
}
