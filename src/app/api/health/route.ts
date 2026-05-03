import { sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

// Public health probe. Intentionally side-effect free: no session read, no
// cookies set, no auth-related work — uptime monitors and Vercel's health
// check must hit this without authentication.
//
// Response shape is fixed to `{ ok, db, timestamp }`; do not extend without
// updating openspec/changes/smoke-health-feature/specs/health-endpoints/spec.md
// because external probes parse this contract.
type HealthBody = {
  ok: boolean;
  db: 'reachable' | 'unreachable';
  timestamp: string;
};

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export async function GET(): Promise<Response> {
  const timestamp = new Date().toISOString();

  try {
    // `select 1` exercises the full Drizzle / postgres-js / TCP path without
    // touching any application table. If the DB is genuinely unreachable
    // (network, auth, or pool failure) this throws and we fall through to the
    // 503 branch.
    await db.execute(sql`select 1`);

    const body: HealthBody = { ok: true, db: 'reachable', timestamp };
    return Response.json(body, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    // Log only the error name/code — never the message or stack, which can
    // leak DB hostnames, query text, or credentials in connection-error paths.
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    logger.warn({ errorName, route: '/api/health' }, 'health probe failed');

    const body: HealthBody = { ok: false, db: 'unreachable', timestamp };
    return Response.json(body, { status: 503, headers: NO_STORE_HEADERS });
  }
}
