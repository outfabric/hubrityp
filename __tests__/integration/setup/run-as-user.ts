import { sql as dsql } from 'drizzle-orm';

import { openClient, type Db } from './db';

// Run `fn` inside a transaction with `request.jwt.claims.sub` set to
// `jwtSub` and the role set to `authenticated`, so RLS policies treat the
// connection as that user. Mirrors how Supabase API requests are evaluated
// in production.
export async function runAsUser<T>(jwtSub: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const { sql, db } = openClient();
  try {
    return await db.transaction(async (tx) => {
      const claims = JSON.stringify({ sub: jwtSub, role: 'authenticated' });
      await tx.execute(dsql.raw(`SET LOCAL role = 'authenticated';`));
      await tx.execute(dsql.raw(`SET LOCAL request.jwt.claims = '${claims}';`));
      return await fn(tx);
    });
  } finally {
    await sql.end();
  }
}
