import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';
import * as schema from '@/lib/db/schema';

export const rawPool = new Pool({
  connectionString: inject('DATABASE_URL'),
  max: 5,
});

export const db = drizzle(rawPool, { schema });
