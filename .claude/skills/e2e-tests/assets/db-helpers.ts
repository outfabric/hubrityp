import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '@/lib/db/schema';

const pool = new Pool({
  connectionString: process.env.E2E_DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool, { schema });

const TABELAS_TRANSACIONAIS = [
  'agendamentos',
  'cobrancas',
  'prontuarios',
  'pacientes',
];

export async function truncateAllExceptSeed() {
  await db.execute(
    sql.raw(
      `TRUNCATE ${TABELAS_TRANSACIONAIS.join(', ')} RESTART IDENTITY CASCADE;`
    )
  );
}

export async function createPaciente(input: {
  psicologoId: string;
  nome?: string;
  cpf?: string;
}) {
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
}

export async function createAgendamento(input: {
  psicologoId: string;
  pacienteId: string;
  horario?: Date;
}) {
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
}
