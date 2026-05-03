import { openClient, type Db } from './db';

// Run `fn` with a connection that bypasses RLS — the postgres superuser the
// container ships with does not have RLS enforced, so this is the right
// channel for fixture setup and teardown.
export async function runAsService<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { sql, db } = openClient();
  try {
    return await fn(db);
  } finally {
    await sql.end();
  }
}
