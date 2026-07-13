/**
 * Reminders dispatcher — Inngest cron function that scans for upcoming
 * sessions and fans out individual `whatsapp/reminder.send` events.
 *
 * Runs every 5 minutes in America/Sao_Paulo timezone. For each psychologist
 * with an active WhatsApp account and configured reminder settings, it:
 *
 *   1. Queries sessions within the reminder window
 *   2. Computes due times via `computeReminderWindow`
 *   3. Checks idempotency (skip if message already sent)
 *   4. Emits `whatsapp/reminder.send` events for the sender function
 *
 * The dispatcher never calls Twilio directly — it only enqueues events.
 */

import { and, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { generatePatientVideoUrl } from '@/modules/telepsicologia/lib/video-url';
import { computeReminderWindow } from '@/modules/whatsapp/lib/reminders/compute-reminder-window';
import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import { resolvePlatformContentSid } from '@/modules/whatsapp/lib/reminders/platform-template-contract';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import {
  reminderSettings,
  whatsappAccounts,
  whatsappMessages,
} from '@/shared/db/schema/whatsapp/tables';
import { logger } from '@/shared/lib/logger';

import { inngest, type ReminderSendEventData } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * How far ahead to look for sessions. 48h is the maximum early reminder
 * window, plus some buffer for the cron interval.
 */
const LOOK_AHEAD_HOURS = 50;

/** Maps reminder kind to the template key used in message_templates. */
const KIND_TO_TEMPLATE_KEY: Record<string, string> = {
  early: 'lembrete_24h',
  final: 'lembrete_2h',
  video: 'link_video',
};

// ---------------------------------------------------------------------------
// Types (internal to the dispatcher)
// ---------------------------------------------------------------------------

/**
 * Minimal DB interface — any Drizzle Postgres client or transaction.
 * Uses a generic so the module doesn't depend on a specific schema import
 * at the type level (avoids circular self-reference).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

interface ActivePsychologist {
  userId: string;
  whatsappAccountId: string;
  displayName: string;
  earlyReminderHours: number | null;
  finalReminderHours: number | null;
  videoLinkMinutes: number;
  sendDuringNight: boolean;
}

interface SessionCandidate {
  id: string;
  patientId: string | null;
  startAt: Date;
  modality: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Query helpers (extracted for testability)
// ---------------------------------------------------------------------------

/**
 * Fetches psychologists with active WhatsApp accounts AND configured
 * reminder settings. Bypasses RLS (runs as service role in Inngest).
 */
export async function fetchActivePsychologists(db: DrizzleDb): Promise<ActivePsychologist[]> {
  const rows = await db
    .select({
      userId: whatsappAccounts.userId,
      whatsappAccountId: whatsappAccounts.id,
      displayName: profiles.fullName,
      earlyReminderHours: reminderSettings.earlyReminderHours,
      finalReminderHours: reminderSettings.finalReminderHours,
      videoLinkMinutes: reminderSettings.videoLinkMinutes,
      sendDuringNight: reminderSettings.sendDuringNight,
    })
    .from(whatsappAccounts)
    .innerJoin(reminderSettings, eq(whatsappAccounts.userId, reminderSettings.userId))
    .innerJoin(profiles, eq(whatsappAccounts.userId, profiles.userId))
    .where(eq(whatsappAccounts.status, 'active'));

  return rows;
}

/**
 * Fetches sessions for a given psychologist that are scheduled within the
 * look-ahead window, not cancelled, not soft-deleted, and not opted out
 * of reminders.
 */
export async function fetchSessionCandidates(
  db: DrizzleDb,
  userId: string,
  now: Date,
): Promise<SessionCandidate[]> {
  const lookAheadEnd = new Date(now.getTime() + LOOK_AHEAD_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: sessions.id,
      patientId: sessions.patientId,
      startAt: sessions.startAt,
      modality: sessions.modality,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.status, 'scheduled'),
        eq(sessions.remindersDisabled, false),
        gte(sessions.startAt, now),
        lte(sessions.startAt, lookAheadEnd),
        isNull(sessions.deletedAt),
      ),
    );

  return rows;
}

/**
 * Checks if an idempotency key already exists in whatsapp_messages
 * with a non-failed status (meaning the message was already sent or queued).
 */
export async function idempotencyKeyExists(db: DrizzleDb, key: string): Promise<boolean> {
  const rows = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.idempotencyKey, key), ne(whatsappMessages.status, 'failed')))
    .limit(1);

  return rows.length > 0;
}

/**
 * Fetches patient data needed for the reminder event payload.
 */
async function fetchPatientData(
  db: DrizzleDb,
  patientId: string,
): Promise<{ firstName: string; fullName: string; phone: string; optedOut: boolean } | null> {
  const rows = await db
    .select({
      fullName: patients.fullName,
      phone: patients.phone,
      reminderPhone: patients.reminderPhone,
      whatsappOptOut: patients.whatsappOptOut,
    })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);

  if (rows.length === 0) return null;

  const patient = rows[0]!;
  const phone = patient.reminderPhone ?? patient.phone;
  if (!phone) return null;

  const firstName = patient.fullName.split(' ')[0] ?? patient.fullName;

  return {
    firstName,
    fullName: patient.fullName,
    phone,
    optedOut: patient.whatsappOptOut,
  };
}

/**
 * Fetches the patient video URL for an online session by querying
 * `video_rooms`. Returns `null` when no room exists (auto-creation
 * may not have fired yet) or when `appUrl` is not configured.
 */
export async function fetchVideoLink(
  db: DrizzleDb,
  sessionId: string,
  appUrl: string | undefined,
): Promise<string | null> {
  if (!appUrl) return null;

  const rows = await db
    .select({ patientToken: videoRooms.patientToken })
    .from(videoRooms)
    .where(eq(videoRooms.sessionId, sessionId))
    .limit(1);

  if (rows.length === 0) return null;

  return generatePatientVideoUrl(appUrl, rows[0]!.patientToken);
}

/**
 * Batch-fetches patient video URLs for multiple sessions in a single
 * `WHERE session_id IN (...)` query, eliminating the N+1 pattern when
 * dispatching reminders for online sessions.
 *
 * @returns Map from sessionId to the patient video URL. Sessions without
 *   a room (auto-creation not yet fired) are absent from the map.
 */
export async function fetchVideoLinksBatch(
  db: DrizzleDb,
  sessionIds: string[],
  appUrl: string | undefined,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!appUrl || sessionIds.length === 0) return result;

  const rows = await db
    .select({
      sessionId: videoRooms.sessionId,
      patientToken: videoRooms.patientToken,
    })
    .from(videoRooms)
    .where(inArray(videoRooms.sessionId, sessionIds));

  for (const row of rows) {
    result.set(row.sessionId, generatePatientVideoUrl(appUrl, row.patientToken));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core dispatcher logic (extracted for testing)
// ---------------------------------------------------------------------------

/** Event shape emitted by the dispatcher for fan-out. */
export interface ReminderSendFanOutEvent {
  name: 'whatsapp/reminder.send';
  data: ReminderSendEventData;
}

export interface DispatcherDeps {
  db: DrizzleDb;
  now: Date;
  sendEvents: (stepId: string, events: ReminderSendFanOutEvent[]) => Promise<unknown>;
  /** App base URL for building absolute patient-facing links (e.g. video URLs). */
  appUrl?: string;
}

/**
 * Core dispatcher logic — scans psychologists, their sessions, computes
 * reminder windows, and emits fan-out events. Extracted from the Inngest
 * handler for testability.
 */
export async function dispatchReminders(deps: DispatcherDeps): Promise<{
  psychologistsScanned: number;
  eventsEmitted: number;
}> {
  const { db, now, sendEvents, appUrl } = deps;

  const psychologists = await fetchActivePsychologists(db);

  let totalEventsEmitted = 0;

  for (const psych of psychologists) {
    const sessionCandidates = await fetchSessionCandidates(db, psych.userId, now);

    // Pre-fetch video links for all online sessions in a single query
    // to avoid N+1 sequential DB round-trips inside the loop.
    const onlineSessionIds = sessionCandidates
      .filter((s) => (s.modality ?? 'in_person') === 'online')
      .map((s) => s.id);
    const videoLinkMap = await fetchVideoLinksBatch(db, onlineSessionIds, appUrl);

    const eventsToSend: ReminderSendFanOutEvent[] = [];

    for (const session of sessionCandidates) {
      if (!session.patientId) continue;

      // Check patient opt-out and fetch patient data
      const patientData = await fetchPatientData(db, session.patientId);
      if (!patientData || patientData.optedOut) continue;

      // Compute reminder windows
      const window = computeReminderWindow(
        {
          startAt: session.startAt,
          createdAt: session.createdAt,
          modality: session.modality ?? undefined,
        },
        {
          early_reminder_hours: psych.earlyReminderHours,
          final_reminder_hours: psych.finalReminderHours,
          video_link_minutes: psych.videoLinkMinutes,
          send_during_night: psych.sendDuringNight,
        },
        now,
        SAO_PAULO_TZ,
      );

      // Check each reminder kind
      const dueTimes: Array<{ kind: string; dueAt: Date | null }> = [
        { kind: 'early', dueAt: window.earlyDueAt },
        { kind: 'final', dueAt: window.finalDueAt },
        { kind: 'video', dueAt: window.videoDueAt },
      ];

      for (const { kind, dueAt } of dueTimes) {
        if (!dueAt) continue;

        // Only dispatch if the due time is in the past (i.e., it's time to send)
        if (dueAt > now) continue;

        // Resolve the platform template key + Content SID for this kind.
        // The SID comes from `serverEnv` (via the contract), never from
        // `message_templates` — a missing/unseeded row no longer blocks a send.
        const templateKey = KIND_TO_TEMPLATE_KEY[kind];
        if (!templateKey) continue;

        const contentSid = resolvePlatformContentSid(templateKey);
        if (!contentSid) continue;

        // Look up pre-fetched video link for online sessions.
        const sessionModality = session.modality ?? 'in_person';
        const videoLink =
          sessionModality === 'online' ? (videoLinkMap.get(session.id) ?? null) : null;

        // The video reminder needs a resolvable session link. When the room has
        // not been provisioned yet, skip this tick WITHOUT recording anything —
        // no idempotency row is written, so the next 5-minute tick retries once
        // the room (and its link) exists.
        if (kind === 'video' && !videoLink) {
          logger.warn(
            { event: 'video_link_unavailable', sessionId: session.id },
            'Skipping video reminder — patient session link not yet available',
          );
          continue;
        }

        const idempotencyKey = generateIdempotencyKey(session.id, kind);

        // Check idempotency — skip if already sent
        const alreadySent = await idempotencyKeyExists(db, idempotencyKey);
        if (alreadySent) continue;

        eventsToSend.push({
          name: 'whatsapp/reminder.send',
          data: {
            userId: psych.userId,
            sessionId: session.id,
            patientId: session.patientId,
            kind,
            idempotencyKey,
            whatsappAccountId: psych.whatsappAccountId,
            templateKey,
            patientPhone: patientData.phone,
            patientFirstName: patientData.firstName,
            patientFullName: patientData.fullName,
            psychologistDisplayName: psych.displayName,
            sessionStartAt: session.startAt.toISOString(),
            sessionModality,
            videoLink,
            contentSid,
          },
        });
      }
    }

    if (eventsToSend.length > 0) {
      await sendEvents(`fan-out-${psych.userId}`, eventsToSend);
      totalEventsEmitted += eventsToSend.length;
    }
  }

  return {
    psychologistsScanned: psychologists.length,
    eventsEmitted: totalEventsEmitted,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const remindersDispatcher = inngest.createFunction(
  {
    id: 'whatsapp-reminders-dispatcher',
    triggers: [{ cron: 'TZ=America/Sao_Paulo */5 * * * *' }],
  },
  async ({ step, logger }) => {
    // Import DB client lazily to avoid module-level side effects in tests
    const { db } = await import('@/shared/db/client');
    const { serverEnv } = await import('@/shared/env');

    const result = await dispatchReminders({
      db,
      now: new Date(),
      appUrl: serverEnv.APP_URL,
      sendEvents: async (stepId, events) => {
        await step.sendEvent(stepId, events);
      },
    });

    logger.info(
      {
        event: 'reminders_dispatcher_complete',
        psychologistsScanned: result.psychologistsScanned,
        eventsEmitted: result.eventsEmitted,
      },
      `Dispatcher scanned ${result.psychologistsScanned} psychologists, emitted ${result.eventsEmitted} events`,
    );

    return result;
  },
);
