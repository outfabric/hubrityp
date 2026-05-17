/**
 * Daily cron that identifies completed sessions missing a linked evolution
 * note and emits in-app notifications reminding the psychologist to write one.
 *
 * Rule: sessions with `status = 'done'` whose `created_at` is older than 7
 * days AND have NO row in `evolutions` where `evolutions.session_id = sessions.id`
 * are flagged. For each match, a notification is created via the notifications
 * module.
 *
 * Runs daily at 09:00 America/Sao_Paulo.
 */

import { and, eq, isNull, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { notify } from '@/modules/notifications';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRACE_PERIOD_DAYS = 7;

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

/** Minimal DB interface — any Drizzle Postgres client or transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface MissingEvolutionMatch {
  sessionId: string;
  userId: string;
  patientId: string;
  patientFirstName: string;
  sessionCreatedAt: Date;
}

export interface RemindMissingEvolutionDeps {
  db: DrizzleDb;
  now: Date;
}

// ---------------------------------------------------------------------------
// Query logic (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Finds sessions with `status = 'done'` older than 7 days that have no
 * linked evolution row. Uses a LEFT JOIN on evolutions and filters where
 * the evolution id IS NULL (anti-join pattern).
 */
export async function findSessionsMissingEvolution(
  deps: RemindMissingEvolutionDeps,
): Promise<MissingEvolutionMatch[]> {
  const { db, now } = deps;

  const cutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      patientId: patients.id,
      patientFullName: patients.fullName,
      sessionCreatedAt: sessions.createdAt,
    })
    .from(sessions)
    .innerJoin(patients, eq(sessions.patientId, patients.id))
    .leftJoin(evolutions, eq(evolutions.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.status, 'done'),
        lt(sessions.createdAt, cutoff),
        isNull(sessions.deletedAt),
        isNull(evolutions.id),
      ),
    );

  // Minimize PII: store only the first name in the notification text.
  // The notifications table is user_id-scoped via RLS (SELECT + UPDATE only),
  // but LGPD art. 11 data minimization still applies — avoid storing the full
  // patient name in a context where it is not strictly necessary.
  return rows.map((r) => ({
    sessionId: r.sessionId,
    userId: r.userId,
    patientId: r.patientId,
    patientFirstName: r.patientFullName.split(' ')[0] ?? r.patientFullName,
    sessionCreatedAt: r.sessionCreatedAt,
  }));
}

/**
 * Core logic: find missing evolutions and create notifications.
 * Extracted from the Inngest handler for testability.
 */
export async function remindMissingEvolutions(deps: RemindMissingEvolutionDeps): Promise<{
  sessionsScanned: number;
  notificationsCreated: number;
}> {
  const { db } = deps;

  const matches = await findSessionsMissingEvolution(deps);

  let notificationsCreated = 0;

  for (const match of matches) {
    const sessionDate = match.sessionCreatedAt.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });

    await notify(db, {
      userId: match.userId,
      type: 'missing_evolution',
      title: `Sessao de ${sessionDate} com ${match.patientFirstName} ainda nao possui evolucao`,
      actionUrl: `/pacientes/${match.patientId}/prontuario/evolucoes/nova?sessionId=${match.sessionId}`,
    });

    notificationsCreated++;
  }

  return {
    sessionsScanned: matches.length,
    notificationsCreated,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const remindMissingEvolution = inngest.createFunction(
  {
    id: 'prontuario-remind-missing-evolution',
    triggers: [{ cron: 'TZ=America/Sao_Paulo 0 9 * * *' }],
  },
  async ({ logger }) => {
    // Import DB client lazily to avoid module-level side effects in tests
    const { db } = await import('@/shared/db/client');

    const result = await remindMissingEvolutions({ db, now: new Date() });

    logger.info(
      {
        event: 'remind_missing_evolution_complete',
        sessionsScanned: result.sessionsScanned,
        notificationsCreated: result.notificationsCreated,
      },
      `Scanned ${result.sessionsScanned} sessions missing evolution, created ${result.notificationsCreated} notifications`,
    );

    return result;
  },
);
