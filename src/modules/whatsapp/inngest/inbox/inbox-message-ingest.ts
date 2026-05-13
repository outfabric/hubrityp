/**
 * Inbox message ingest — Inngest function that processes a persisted
 * inbound WhatsApp message for the psychologist's inbox.
 *
 * Triggered by `whatsapp/message.persisted` events emitted after a
 * message is saved to `whatsapp_messages`.
 *
 * Steps:
 *   1. Fetch the message by `messageId` from `whatsapp_messages`
 *   2. Run risk-keyword detection; if flagged, update the message row
 *   3. Upsert `whatsapp_conversations` — increment unread_count,
 *      update last_message_id/at/preview, set has_risk if flagged
 *   4. Insert an in-app notification for the psychologist
 */

import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { detectRiskKeywords } from '@/modules/whatsapp/lib/inbox/detect-risk-keywords';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappConversations, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest, WHATSAPP_EVENTS, type MessagePersistedEventData } from '../client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum length for `last_message_preview` in whatsapp_conversations. */
const PREVIEW_MAX_LENGTH = 80;

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

/** Notification payload matching the shape expected by `notify()`. */
export interface IngestNotification {
  userId: string;
  type: string;
  title: string;
  body?: string;
  actionUrl?: string;
}

export interface IngestDeps {
  db: DrizzleDb;
  notify: (db: DrizzleDb, payload: IngestNotification) => Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface IngestResult {
  status: 'processed' | 'not_found';
  riskFlagged: boolean;
  riskKeywords: string[];
  conversationId?: string;
  notificationId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncates a string to `maxLen` characters, appending "..." if shortened.
 */
function truncatePreview(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

// ---------------------------------------------------------------------------
// Core logic (extracted for testing)
// ---------------------------------------------------------------------------

/**
 * Processes a persisted inbound message: detects risk keywords, upserts
 * the conversation aggregate, and dispatches an in-app notification.
 */
export async function processInboxMessageIngest(
  eventData: MessagePersistedEventData,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { db, notify } = deps;
  const { messageId, userId, patientId } = eventData;

  // -----------------------------------------------------------------------
  // Step 1: Fetch the message from whatsapp_messages
  // -----------------------------------------------------------------------
  const [message] = await db
    .select({
      id: whatsappMessages.id,
      body: whatsappMessages.body,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.id, messageId))
    .limit(1);

  if (!message) {
    return { status: 'not_found', riskFlagged: false, riskKeywords: [] };
  }

  const body = message.body ?? '';

  // -----------------------------------------------------------------------
  // Step 2: Risk-keyword detection
  // -----------------------------------------------------------------------
  const riskResult = detectRiskKeywords(body);

  if (riskResult.flagged) {
    await db
      .update(whatsappMessages)
      .set({
        riskFlag: true,
        riskKeywords: riskResult.keywords,
      })
      .where(eq(whatsappMessages.id, messageId));
  }

  // -----------------------------------------------------------------------
  // Step 3: Upsert whatsapp_conversations
  // -----------------------------------------------------------------------
  const preview = truncatePreview(body, PREVIEW_MAX_LENGTH);
  const messageAt = message.createdAt;

  // Build the upsert — ON CONFLICT (user_id, patient_id) DO UPDATE
  const upsertResult = await db
    .insert(whatsappConversations)
    .values({
      userId,
      patientId,
      lastMessageId: messageId,
      lastMessageAt: messageAt,
      lastMessagePreview: preview,
      unreadCount: 1,
      hasRisk: riskResult.flagged,
    })
    .onConflictDoUpdate({
      target: [whatsappConversations.userId, whatsappConversations.patientId],
      set: {
        lastMessageId: sql`EXCLUDED.last_message_id`,
        lastMessageAt: sql`EXCLUDED.last_message_at`,
        lastMessagePreview: sql`EXCLUDED.last_message_preview`,
        unreadCount: sql`${whatsappConversations.unreadCount} + 1`,
        // Only flip to true, never flip back to false on a non-risk message
        hasRisk: riskResult.flagged ? sql`true` : sql`${whatsappConversations.hasRisk}`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: whatsappConversations.id });

  const conversationId = upsertResult[0]?.id;

  // -----------------------------------------------------------------------
  // Step 4: Fetch patient name for the notification title
  // -----------------------------------------------------------------------
  const [patient] = await db
    .select({ fullName: patients.fullName })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  const patientName = patient?.fullName ?? 'Paciente';

  // -----------------------------------------------------------------------
  // Step 5: In-app notification
  // -----------------------------------------------------------------------
  let notificationId: string | undefined;

  if (riskResult.flagged) {
    const result = await notify(db, {
      userId,
      type: 'inbox_risk_message',
      title: `Mensagem com alerta de risco recebida de ${patientName}`,
      body: `Palavras-chave detectadas: ${riskResult.keywords.join(', ')}`,
      actionUrl: `/app/inbox?patient=${patientId}`,
    });
    notificationId = result.id;
  } else {
    const result = await notify(db, {
      userId,
      type: 'inbox_new_message',
      title: `Nova mensagem de ${patientName}`,
      actionUrl: `/app/inbox?patient=${patientId}`,
    });
    notificationId = result.id;
  }

  return {
    status: 'processed',
    riskFlagged: riskResult.flagged,
    riskKeywords: riskResult.keywords,
    conversationId,
    notificationId,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const inboxMessageIngest = inngest.createFunction(
  {
    id: 'whatsapp-inbox-message-ingest',
    triggers: [{ event: WHATSAPP_EVENTS.MESSAGE_PERSISTED }],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const { notify } = await import('@/modules/notifications');
    const data = event.data as MessagePersistedEventData;

    const result = await step.run('process-inbox-ingest', async () => {
      return processInboxMessageIngest(data, { db, notify });
    });

    logger.info(
      {
        event: 'inbox_message_ingested',
        status: result.status,
        messageId: data.messageId,
        riskFlagged: result.riskFlagged,
        conversationId: result.conversationId,
      },
      `Inbox ingest: ${result.status}, risk=${result.riskFlagged}`,
    );

    return result;
  },
);
