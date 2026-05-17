import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { auditLog } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const logProntuarioAccessSchema = z.object({
  action: z.string().min(1, { message: 'action é obrigatório.' }),
  resourceType: z.string().min(1, { message: 'resourceType é obrigatório.' }),
  resourceId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Writes an audit_log entry for prontuario access events.
 *
 * **Why service-role / direct Drizzle INSERT is used here:**
 * The `audit_log` table has NO authenticated INSERT policy by design (see
 * policies.ts). This prevents users from forging or poisoning the audit
 * trail. Only server-side code (via direct Drizzle INSERT which bypasses
 * RLS because the postgres-js pool connects as the DB owner/service-role)
 * can write audit entries. The caller is still authenticated via
 * `supabase.auth.getUser()` — the user's id from the verified session is
 * used as `user_id`, never a client-supplied value.
 *
 * IP address is extracted from `x-forwarded-for` or `x-real-ip` headers.
 *
 * This is fire-and-forget: errors are logged internally but never surfaced
 * to the user. The function returns void and swallows exceptions.
 */
export async function logProntuarioAccessImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<void> {
  // 1. Authenticate — reject unauthenticated calls
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    logger.warn(
      { event: 'log_prontuario_access_unauthenticated' },
      'unauthenticated call to logProntuarioAccess rejected',
    );
    throw new Error('UNAUTHORIZED');
  }

  // 2. Validate input
  const parsed = logProntuarioAccessSchema.safeParse(input);
  if (!parsed.success) {
    logger.warn(
      { event: 'log_prontuario_access_invalid_input' },
      'invalid input to logProntuarioAccess',
    );
    return;
  }

  const { action, resourceType, resourceId, metadata } = parsed.data;
  const userId = user.id;

  // 3. Extract IP from request headers
  let ipAddress: string | null = null;
  try {
    const headerStore = await headers();
    ipAddress =
      headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerStore.get('x-real-ip') ??
      null;
  } catch {
    // headers() may throw in non-request contexts (e.g., Inngest jobs);
    // IP is best-effort, not critical.
  }

  // 4. Write to audit_log via direct Drizzle INSERT (service-role context).
  // The db client connects as the DB owner (postgres), which bypasses RLS.
  // This is intentional — audit_log has no INSERT policy for authenticated
  // users to prevent log forgery/poisoning (design.md decision #4).
  try {
    await db.insert(auditLog).values({
      userId,
      action,
      resourceType,
      resourceId: resourceId ?? null,
      metadata: metadata ?? {},
      ipAddress,
    });
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'log_prontuario_access_failed', errorCode: pgError.code },
      'failed to write audit_log entry',
    );
    // Fire-and-forget: swallow the error
  }
}
