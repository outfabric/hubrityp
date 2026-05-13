import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, gt, ilike, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappConversations } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface ListConversationsInput {
  page?: number;
  onlyUnread?: boolean;
  onlyRisk?: boolean;
  search?: string;
}

export interface ConversationListItem {
  conversationId: string;
  patientId: string;
  patientName: string;
  /** Two uppercase initials derived from the patient name. */
  patientInitials: string;
  lastMessagePreview: string;
  lastMessageAt: Date;
  unreadCount: number;
  hasRisk: boolean;
}

export type ListConversationsResult =
  | { ok: true; conversations: ConversationListItem[]; total: number; page: number }
  | { ok: false; error: 'unauthenticated' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives two uppercase initials from a full name. Falls back to "??" if the
 * name is empty or has no word characters.
 */
function deriveInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Lists paginated conversations for the authenticated psychologist.
 *
 * Joins `whatsapp_conversations` with `patients` to include patient name
 * and initials. Supports filtering by unread, risk, and patient name search.
 * Results are ordered by `last_message_at DESC`.
 */
export async function listConversationsImpl(
  supabase: SupabaseClient,
  input: ListConversationsInput = {},
): Promise<ListConversationsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const page = input.page ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  // 2. Build WHERE conditions
  const conditions = [eq(whatsappConversations.userId, user.id)];

  if (input.onlyUnread) {
    conditions.push(gt(whatsappConversations.unreadCount, 0));
  }

  if (input.onlyRisk) {
    conditions.push(eq(whatsappConversations.hasRisk, true));
  }

  if (input.search) {
    conditions.push(ilike(patients.fullName, `%${input.search}%`));
  }

  const whereClause = and(...conditions);

  // 3. Count total for pagination
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(whatsappConversations)
    .innerJoin(patients, eq(whatsappConversations.patientId, patients.id))
    .where(whereClause);

  const total = countRow?.count ?? 0;

  // 4. Query with JOIN, pagination, ordering
  const rows = await db
    .select({
      conversationId: whatsappConversations.id,
      patientId: whatsappConversations.patientId,
      patientName: patients.fullName,
      lastMessagePreview: whatsappConversations.lastMessagePreview,
      lastMessageAt: whatsappConversations.lastMessageAt,
      unreadCount: whatsappConversations.unreadCount,
      hasRisk: whatsappConversations.hasRisk,
    })
    .from(whatsappConversations)
    .innerJoin(patients, eq(whatsappConversations.patientId, patients.id))
    .where(whereClause)
    .orderBy(desc(whatsappConversations.lastMessageAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  // 5. Map to output with initials
  const conversations: ConversationListItem[] = rows.map((row) => ({
    conversationId: row.conversationId,
    patientId: row.patientId,
    patientName: row.patientName,
    patientInitials: deriveInitials(row.patientName),
    lastMessagePreview: row.lastMessagePreview,
    lastMessageAt: row.lastMessageAt,
    unreadCount: row.unreadCount,
    hasRisk: row.hasRisk,
  }));

  return { ok: true, conversations, total, page };
}
