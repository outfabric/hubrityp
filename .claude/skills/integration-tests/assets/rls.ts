import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/shared/db/schema';
import { rawPool } from './db';

type ScopedDb = ReturnType<typeof drizzle<typeof schema>>;

export async function runAsUser<T>(
  userId: string,
  fn: (db: ScopedDb) => Promise<T>
): Promise<T> {
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE authenticated;`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true);`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const scoped = drizzle(client, { schema });
    const result = await fn(scoped);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function runAsService<T>(
  fn: (db: ScopedDb) => Promise<T>
): Promise<T> {
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE postgres;`);
    const scoped = drizzle(client, { schema });
    const result = await fn(scoped);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const TABELAS_PADRAO = [
  'agendamentos',
  'pacientes',
  'psicologos',
  'auth.users',
];

export async function truncateAll(_db: ScopedDb, tabelas = TABELAS_PADRAO) {
  await rawPool.query(
    `TRUNCATE ${tabelas.join(', ')} RESTART IDENTITY CASCADE;`
  );
}
