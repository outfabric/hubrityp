import 'server-only';

import { and, eq, isNull, lte } from 'drizzle-orm';

import { inngest } from '@/modules/agenda/inngest/client';
import type { SessionMissingNoteReminderEvent } from '@/modules/agenda/lib/session-events';
import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MissingNoteSession {
  sessionId: string;
  patientId: string;
  userId: string;
  updatedAt: Date;
  daysSinceDone: number;
}

export interface MissingNoteReminderResult {
  sessionsFound: MissingNoteSession[];
  events: SessionMissingNoteReminderEvent[];
}

// ---------------------------------------------------------------------------
// Core query logic (testable, decoupled from Inngest)
// ---------------------------------------------------------------------------

/**
 * Queries sessions eligible for missing-note reminders (RN-03.06).
 *
 * A session qualifies when:
 *   - `status = 'done'`
 *   - `updated_at < NOW() - INTERVAL '7 days'` (done for more than 7 days)
 *   - `deleted_at IS NULL` (not soft-deleted)
 *
 * The clinical note check is initially stubbed: all qualifying sessions are
 * considered to be missing notes. When the `evolutions` table is implemented,
 * this function should LEFT JOIN against it and filter out sessions that
 * already have a clinical note.
 *
 * For each qualifying session, builds a `SessionMissingNoteReminderEvent`
 * payload suitable for emission via Inngest.
 */
export async function findSessionsMissingNotes(): Promise<MissingNoteReminderResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: sessions.id,
      patientId: sessions.patientId,
      userId: sessions.userId,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.status, 'done'),
        lte(sessions.updatedAt, sevenDaysAgo),
        isNull(sessions.deletedAt),
      ),
    );

  // Filter out sessions without a patient (blocking slots) -- they cannot
  // have clinical notes.
  const eligibleSessions = rows.filter(
    (row): row is typeof row & { patientId: string } => row.patientId !== null,
  );

  const sessionsFound: MissingNoteSession[] = eligibleSessions.map((row) => {
    const daysSinceDone = Math.floor(
      (Date.now() - row.updatedAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    return {
      sessionId: row.id,
      patientId: row.patientId,
      userId: row.userId,
      updatedAt: row.updatedAt,
      daysSinceDone,
    };
  });

  const events: SessionMissingNoteReminderEvent[] = sessionsFound.map((session) => ({
    sessionId: session.sessionId,
    patientId: session.patientId,
    userId: session.userId,
    doneAt: session.updatedAt,
    daysSinceDone: session.daysSinceDone,
  }));

  return { sessionsFound, events };
}

// ---------------------------------------------------------------------------
// Inngest scheduled function (placeholder)
// ---------------------------------------------------------------------------

/**
 * Inngest scheduled function that runs daily at 8 AM (cron: "0 8 * * *").
 *
 * When the Inngest client is configured in the project, this function will
 * be registered as:
 *
 * ```ts
 * inngest.createFunction(
 *   { id: 'agenda/missing-note-reminder', name: 'Missing Note Reminder' },
 *   { cron: '0 8 * * *' },
 *   async ({ step }) => {
 *     const result = await findSessionsMissingNotes();
 *     for (const event of result.events) {
 *       await step.sendEvent('send-reminder', {
 *         name: 'agenda/session.missing_note_reminder',
 *         data: event,
 *       });
 *     }
 *     return { sessionsNotified: result.events.length };
 *   },
 * );
 * ```
 *
 * Until then, `findSessionsMissingNotes` is the testable core logic and
 * can be invoked directly from integration tests.
 */
export async function runMissingNoteReminder(): Promise<{
  sessionsNotified: number;
  events: SessionMissingNoteReminderEvent[];
}> {
  const result = await findSessionsMissingNotes();

  logger.info(
    { event: 'missing_note_reminder_run', count: result.events.length },
    `found ${result.events.length} done session(s) missing clinical notes`,
  );

  // Emit one event per eligible session. Each send is isolated in its own
  // try/catch so a single failure does not block the remaining reminders.
  for (const event of result.events) {
    try {
      await inngest.send({
        name: 'agenda/session.missing_note_reminder',
        data: event,
      });
    } catch (inngestErr: unknown) {
      const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
      logger.error(
        {
          event: 'inngest_send_failed',
          eventName: 'agenda/session.missing_note_reminder',
          sessionId: event.sessionId,
          error: errMsg,
        },
        'failed to send agenda/session.missing_note_reminder event',
      );
    }
  }

  return { sessionsNotified: result.events.length, events: result.events };
}
