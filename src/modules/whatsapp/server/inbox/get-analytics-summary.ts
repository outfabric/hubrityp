import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, between, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface AnalyticsSummaryInput {
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AnalyticsSummary {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalConfirmed: number;
  totalFailed: number;
  estimatedCostBrl: number;
}

export type GetAnalyticsSummaryResult =
  | { ok: true; data: AnalyticsSummary }
  | { ok: false; error: 'unauthenticated' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the start-of-month and end-of-month for the current month in UTC.
 */
function currentMonthRange(): { dateFrom: Date; dateTo: Date } {
  const now = new Date();
  const dateFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dateTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
  return { dateFrom, dateTo };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns aggregated WhatsApp analytics for the authenticated psychologist
 * within a given period. Defaults to the current month when no period is
 * provided.
 *
 * Metrics:
 * - `totalSent`: outbound messages
 * - `totalDelivered`: messages with status 'delivered' or 'read'
 * - `totalRead`: messages with status 'read'
 * - `totalConfirmed`: sessions confirmed (via `confirmed_at`) where the
 *    session had at least one WhatsApp message in the period
 * - `totalFailed`: messages with status 'failed'
 * - `estimatedCostBrl`: count of outbound template messages multiplied by
 *    the per-template price from the environment variable
 */
export async function getAnalyticsSummaryImpl(
  supabase: SupabaseClient,
  input: AnalyticsSummaryInput = {},
  deps: { templatePriceBrl: number } = { templatePriceBrl: 0.1 },
): Promise<GetAnalyticsSummaryResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Resolve period
  const defaults = currentMonthRange();
  const dateFrom = input.dateFrom ?? defaults.dateFrom;
  const dateTo = input.dateTo ?? defaults.dateTo;

  // 3. Query message-level aggregates in a single pass
  const messageConditions = and(
    eq(whatsappMessages.userId, user.id),
    between(whatsappMessages.createdAt, dateFrom, dateTo),
  );

  const [messageStats] = await db
    .select({
      totalSent: sql<number>`count(*) filter (where ${whatsappMessages.direction} = 'outbound')::int`,
      totalDelivered: sql<number>`count(*) filter (where ${whatsappMessages.status} in ('delivered', 'read'))::int`,
      totalRead: sql<number>`count(*) filter (where ${whatsappMessages.status} = 'read')::int`,
      totalFailed: sql<number>`count(*) filter (where ${whatsappMessages.status} = 'failed')::int`,
      templateCount: sql<number>`count(*) filter (where ${whatsappMessages.direction} = 'outbound' and ${whatsappMessages.templateKey} is not null)::int`,
    })
    .from(whatsappMessages)
    .where(messageConditions);

  const totalSent = messageStats?.totalSent ?? 0;
  const totalDelivered = messageStats?.totalDelivered ?? 0;
  const totalRead = messageStats?.totalRead ?? 0;
  const totalFailed = messageStats?.totalFailed ?? 0;
  const templateCount = messageStats?.templateCount ?? 0;

  // 4. Query confirmed sessions that have at least one WhatsApp message in
  //    the period (via JOIN on session_id).
  const [confirmedRow] = await db
    .select({
      totalConfirmed: sql<number>`count(distinct ${sessions.id})::int`,
    })
    .from(sessions)
    .innerJoin(whatsappMessages, eq(whatsappMessages.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.userId, user.id),
        sql`${sessions.confirmedAt} is not null`,
        between(whatsappMessages.createdAt, dateFrom, dateTo),
      ),
    );

  const totalConfirmed = confirmedRow?.totalConfirmed ?? 0;

  // 5. Calculate estimated cost
  const estimatedCostBrl = templateCount * deps.templatePriceBrl;

  return {
    ok: true,
    data: {
      totalSent,
      totalDelivered,
      totalRead,
      totalConfirmed,
      totalFailed,
      estimatedCostBrl,
    },
  };
}
