import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { searchMessageSchema } from '@/modules/whatsapp/lib/inbox/search-message-schema';
import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappMessages, type WhatsappMessage } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface SearchResultItem {
  message: WhatsappMessage;
  patientName: string;
}

export type SearchMessageHistoryResult =
  | { ok: true; results: SearchResultItem[]; total: number; page: number }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Full-text search over `whatsapp_messages.body` using Postgres
 * `to_tsvector('portuguese', body) @@ plainto_tsquery('portuguese', query)`.
 *
 * Supports optional filtering by `patientId` and `dateRange`, with
 * pagination (default page size 20, max 100).
 *
 * Results are ordered by `created_at DESC` and include the patient name
 * via a JOIN with `patients`.
 */
export async function searchMessageHistoryImpl(
  supabase: SupabaseClient,
  rawInput: unknown,
): Promise<SearchMessageHistoryResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = searchMessageSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { query, patientId, dateRange, page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;

  // 3. Build WHERE conditions
  const conditions = [eq(whatsappMessages.userId, user.id)];

  // Only add FTS condition when a real query string is provided
  if (query && query.trim().length > 0) {
    conditions.push(
      sql`to_tsvector('portuguese', coalesce(${whatsappMessages.body}, '')) @@ plainto_tsquery('portuguese', ${query})`,
    );
  }

  if (patientId) {
    conditions.push(eq(whatsappMessages.patientId, patientId));
  }

  if (dateRange) {
    conditions.push(gte(whatsappMessages.createdAt, new Date(`${dateRange.from}T00:00:00Z`)));
    conditions.push(lte(whatsappMessages.createdAt, new Date(`${dateRange.to}T23:59:59.999Z`)));
  }

  const whereClause = and(...conditions);

  // 4. Count total for pagination
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(whatsappMessages)
    .leftJoin(patients, eq(whatsappMessages.patientId, patients.id))
    .where(whereClause);

  const total = countRow?.count ?? 0;

  // 5. Query with JOIN, pagination, ordering
  const rows = await db
    .select({
      message: whatsappMessages,
      patientName: patients.fullName,
    })
    .from(whatsappMessages)
    .leftJoin(patients, eq(whatsappMessages.patientId, patients.id))
    .where(whereClause)
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(pageSize)
    .offset(offset);

  const results: SearchResultItem[] = rows.map((row) => ({
    message: row.message,
    patientName: row.patientName ?? 'Desconhecido',
  }));

  return { ok: true, results, total, page };
}
