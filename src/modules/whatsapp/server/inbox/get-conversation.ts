import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  whatsappConversations,
  whatsappMessages,
  type WhatsappMessage,
} from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of messages returned when opening a conversation. */
const MESSAGE_LIMIT = 30;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ConversationPatientInfo {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
}

export type GetConversationResult =
  | { ok: true; messages: WhatsappMessage[]; patient: ConversationPatientInfo }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'patient_not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Retrieves the last 30 messages for a conversation identified by `patientId`.
 *
 * Side effects (mark-as-read):
 *   1. Sets `read_at_by_psychologist = now()` on all unread inbound messages.
 *   2. Resets `unread_count = 0` on the `whatsapp_conversations` row.
 *
 * Returns messages in chronological order (ASC) and basic patient info.
 */
export async function getConversationImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<GetConversationResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Fetch patient info
  const [patient] = await db
    .select({
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
    })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, user.id)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 3. Fetch last 30 messages, ordered ASC (chronological)
  const messages = await db
    .select()
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.patientId, patientId), eq(whatsappMessages.userId, user.id)))
    .orderBy(asc(whatsappMessages.createdAt))
    .limit(MESSAGE_LIMIT);

  // 4. Mark unread inbound messages as read
  await db
    .update(whatsappMessages)
    .set({ readAtByPsychologist: sql`now()` })
    .where(
      and(
        eq(whatsappMessages.patientId, patientId),
        eq(whatsappMessages.userId, user.id),
        eq(whatsappMessages.direction, 'inbound'),
        isNull(whatsappMessages.readAtByPsychologist),
      ),
    );

  // 5. Reset unread count on conversation
  await db
    .update(whatsappConversations)
    .set({ unreadCount: 0, updatedAt: sql`now()` })
    .where(
      and(
        eq(whatsappConversations.patientId, patientId),
        eq(whatsappConversations.userId, user.id),
      ),
    );

  return {
    ok: true,
    messages,
    patient: {
      patientId: patient.patientId,
      patientName: patient.patientName,
      patientPhone: patient.patientPhone,
    },
  };
}
