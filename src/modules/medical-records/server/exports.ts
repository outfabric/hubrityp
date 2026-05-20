import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';

import { inngest, MEDICAL_RECORDS_EVENTS } from '@/modules/medical-records/inngest/client';
import { exportFiltersSchema, type ExportFilters } from '@/modules/medical-records/lib/exports';
import { db } from '@/shared/db/client';
import { auditLog, prontuarioExports } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// SECURITY: `db` uses DATABASE_URL (Postgres owner role) which bypasses RLS.
// Every query against user-scoped tables MUST include an explicit ownership filter:
//   .where(and(eq(table.userId, userId), ...))
// where `userId` is derived from supabase.auth.getUser() — never from client input.
// Do not add queries on prontuario_exports or patients without this filter.

// ---------------------------------------------------------------------------
// Result types (discriminated unions — callers pattern-match on `ok`)
// ---------------------------------------------------------------------------

export type RequestExportResult =
  | { ok: true; id: string }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL' };

export type ListExportsResult =
  | { ok: true; exports: ExportSummary[] }
  | { ok: false; code: 'UNAUTHORIZED' | 'VALIDATION_ERROR' | 'INTERNAL' };

export type GetExportSignedUrlResult =
  | { ok: true; signedUrl: string; fileName: string }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'NOT_READY' | 'EXPIRED' | 'STORAGE_ERROR' };

export interface ExportSummary {
  id: string;
  patientName: string;
  patientId: string;
  status: string;
  filters: ExportFilters;
  fileSize: number | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const requestExportInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
  filters: exportFiltersSchema,
});

const listExportsInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }).optional(),
});

const getExportSignedUrlInputSchema = z.object({
  exportId: z.string().uuid({ message: 'exportId deve ser um UUID valido.' }),
});

// ---------------------------------------------------------------------------
// requestProntuarioExportImpl
// ---------------------------------------------------------------------------

/**
 * Creates an asynchronous prontuario PDF export request.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (patientId + filters).
 *   3. Verify patient ownership (defense-in-depth — db bypasses RLS).
 *   4. Insert `prontuario_exports` row with status='pending'.
 *   5. Write audit_log 'prontuario.export-request' with filters + IP.
 *   6. Emit Inngest event `prontuario/export-pdf` to trigger async job.
 *   7. Return { ok: true, id }.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function requestProntuarioExportImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<RequestExportResult> {
  // 1. Authenticate — reject unauthenticated calls BEFORE any DB query
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input shape
  const parsed = requestExportInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { patientId, filters } = parsed.data;
  const userId = user.id;

  // 3. Verify patient belongs to the authenticated user (defense-in-depth:
  // db bypasses RLS, so explicit ownership check prevents cross-tenant writes).
  // Returns NOT_FOUND for both "doesn't exist" and "belongs to someone else"
  // to avoid leaking patient existence.
  const [patient] = await db
    .select({ id: patients.id, fullName: patients.fullName })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Extract IP from request headers (best-effort, for audit trail)
  let ipAddress: string | null = null;
  try {
    const headerStore = await headers();
    ipAddress =
      headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerStore.get('x-real-ip') ??
      null;
  } catch {
    // headers() may throw in non-request contexts; IP is best-effort.
  }

  try {
    // 5. Insert export row with status='pending'
    const [exportRow] = await db
      .insert(prontuarioExports)
      .values({
        userId,
        patientId,
        status: 'pending',
        filters,
      })
      .returning({ id: prontuarioExports.id });

    const exportId = exportRow!.id;

    // 6. Write audit_log entry (fire-and-forget on failure).
    // audit_log has no INSERT policy for authenticated users — service-role
    // writes only (design decision #4). The db client connects as the DB
    // owner (postgres), which bypasses RLS intentionally.
    try {
      // LGPD: redact deliveryEmail before writing to audit metadata.
      // The full filters (including the real email) are stored in the
      // prontuario_exports.filters column (source of truth); the audit
      // entry only records that an alternate email WAS specified.
      const auditFilters = { ...filters };
      if (auditFilters.deliveryEmail) {
        auditFilters.deliveryEmail = '[REDACTED]';
      }

      await db.insert(auditLog).values({
        userId,
        action: 'prontuario.export-request',
        resourceType: 'prontuario_export',
        resourceId: exportId,
        metadata: { filters: auditFilters, ip: ipAddress },
        ipAddress,
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'export_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for prontuario.export-request',
      );
    }

    // 7. Emit Inngest event to trigger async PDF generation.
    // If this fails, the row remains as 'pending' — the job won't run but
    // the export can be retried. We log but do not fail the request.
    try {
      await inngest.send({
        name: MEDICAL_RECORDS_EVENTS.PRONTUARIO_EXPORT_PDF,
        data: { exportId },
      });
    } catch (inngestErr: unknown) {
      const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
      logger.error(
        { event: 'inngest_send_failed', exportId, error: errMsg },
        'failed to enqueue prontuario/export-pdf event',
      );
    }

    return { ok: true, id: exportId };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'request_export_failed', errorCode: pgError.code },
      'unexpected error creating prontuario export',
    );
    return { ok: false, code: 'INTERNAL' };
  }
}

// ---------------------------------------------------------------------------
// listProntuarioExportsImpl
// ---------------------------------------------------------------------------

/**
 * Returns the psychologist's prontuario exports in reverse chronological
 * order, optionally filtered by patientId. Includes patient name via join.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate optional input (patientId filter).
 *   3. Query exports joined to patients, filtered by userId (defense-in-depth).
 *   4. Return exports array.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function listProntuarioExportsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListExportsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = listExportsInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { patientId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Build query conditions (defense-in-depth: explicit userId filter)
    const conditions = [eq(prontuarioExports.userId, userId)];

    if (patientId) {
      conditions.push(eq(prontuarioExports.patientId, patientId));
    }

    const rows = await db
      .select({
        id: prontuarioExports.id,
        patientId: prontuarioExports.patientId,
        patientName: patients.fullName,
        status: prontuarioExports.status,
        filters: prontuarioExports.filters,
        fileSize: prontuarioExports.fileSize,
        createdAt: prontuarioExports.createdAt,
        completedAt: prontuarioExports.completedAt,
        expiresAt: prontuarioExports.expiresAt,
      })
      .from(prontuarioExports)
      .innerJoin(patients, eq(prontuarioExports.patientId, patients.id))
      .where(and(...conditions))
      .orderBy(desc(prontuarioExports.createdAt));

    // Drizzle returns filters as `unknown` (JSONB); cast to the validated
    // type — every row was inserted via Zod-parsed ExportFilters.
    const exports: ExportSummary[] = rows.map((r) => ({
      ...r,
      filters: r.filters as ExportFilters,
    }));

    return { ok: true, exports };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_exports_failed', errorCode: pgError.code },
      'unexpected error listing prontuario exports',
    );
    return { ok: false, code: 'INTERNAL' };
  }
}

// ---------------------------------------------------------------------------
// getExportSignedUrlImpl
// ---------------------------------------------------------------------------

/**
 * Generates a time-limited signed URL for downloading a completed export PDF.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input (exportId UUID).
 *   3. Fetch export by id with explicit userId filter (defense-in-depth).
 *      -> NOT_FOUND if missing (does not reveal existence to other users).
 *   4. Check status === 'ready' -> NOT_READY otherwise.
 *   5. Check expires_at > now() -> EXPIRED otherwise.
 *   6. Generate signed URL from Supabase Storage with expiry clamped to
 *      the row's expires_at.
 *   7. Return { signedUrl, fileName }.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getExportSignedUrlImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetExportSignedUrlResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = getExportSignedUrlInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { exportId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Fetch export (defense-in-depth: explicit userId filter).
    // Returns NOT_FOUND for "doesn't exist" AND "belongs to someone else"
    // to avoid leaking export existence to unauthorized callers.
    const [exportRow] = await db
      .select({
        id: prontuarioExports.id,
        status: prontuarioExports.status,
        storagePath: prontuarioExports.storagePath,
        expiresAt: prontuarioExports.expiresAt,
        patientId: prontuarioExports.patientId,
        createdAt: prontuarioExports.createdAt,
      })
      .from(prontuarioExports)
      .where(and(eq(prontuarioExports.id, exportId), eq(prontuarioExports.userId, userId)))
      .limit(1);

    if (!exportRow) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    // 4. Status check
    if (exportRow.status !== 'ready') {
      return { ok: false, code: 'NOT_READY' };
    }

    // 5. Expiry check
    if (!exportRow.expiresAt || exportRow.expiresAt.getTime() < Date.now()) {
      return { ok: false, code: 'EXPIRED' };
    }

    if (!exportRow.storagePath) {
      return { ok: false, code: 'NOT_READY' };
    }

    // 6. Generate signed URL with expiry clamped to row's expires_at.
    // The signed URL must not outlive the export's expiration.
    const expiresInSeconds = Math.max(
      1,
      Math.floor((exportRow.expiresAt.getTime() - Date.now()) / 1000),
    );

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('prontuario-exports')
      .createSignedUrl(exportRow.storagePath, expiresInSeconds);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      logger.error(
        { event: 'export_signed_url_failed', storageError: signedUrlError?.message },
        'failed to create signed URL for prontuario export PDF',
      );
      return { ok: false, code: 'STORAGE_ERROR' };
    }

    // Rewrite origin for local dev (Docker internal hostname -> browser-facing URL)
    const signedUrl = toBrowserSignedUrl(signedUrlData.signedUrl);

    // 7. Build a human-friendly download filename.
    // Fetch patient first name for the filename (the export row already
    // proved ownership via the userId filter above).
    const [patientRow] = await db
      .select({ fullName: patients.fullName })
      .from(patients)
      .where(eq(patients.id, exportRow.patientId))
      .limit(1);

    const patientFirstName = patientRow?.fullName.trim().split(' ')[0] || 'paciente';
    const dateStr = exportRow.createdAt.toISOString().slice(0, 10);
    const fileName = `prontuario-${patientFirstName}-${dateStr}.pdf`;

    return { ok: true, signedUrl, fileName };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_export_signed_url_failed', errorCode: pgError.code },
      'unexpected error generating signed URL for prontuario export',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal helper: rewrite signed URL origin for local development
// ---------------------------------------------------------------------------

/**
 * In Docker Compose, the server reaches Supabase Storage via an internal
 * hostname (e.g. `http://supabase_kong_hubrityp:8000`) that the browser
 * cannot resolve. `SUPABASE_PUBLIC_URL` provides the externally reachable
 * origin (e.g. `http://localhost:54321`). In production this env var is
 * unset, so the URL passes through unchanged.
 */
function toBrowserSignedUrl(signedUrl: string): string {
  const publicUrl = serverEnv.SUPABASE_PUBLIC_URL;
  if (!publicUrl) return signedUrl;

  // NEXT_PUBLIC_SUPABASE_URL is the Docker-internal Supabase origin (e.g.
  // http://supabase_kong_hubrityp:8000). If misconfigured, signed URLs would
  // be silently rewritten to an incorrect origin.
  const serverOrigin = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  if (!serverOrigin) return signedUrl;

  if (!serverOrigin.startsWith('http')) {
    logger.warn(
      { event: 'signed_url_rewrite_misconfigured', serverOrigin },
      'NEXT_PUBLIC_SUPABASE_URL does not start with http — signed URL rewrite skipped',
    );
    return signedUrl;
  }

  // Only rewrite when the signed URL origin matches the server-internal origin
  if (!signedUrl.startsWith(serverOrigin)) return signedUrl;

  return publicUrl + signedUrl.slice(serverOrigin.length);
}
