import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import { listPatientsQuerySchema } from '@/modules/patients/lib/patient-input-schema';
import type { ListPatientsQuery } from '@/modules/patients/lib/patient-types';
import { db } from '@/shared/db/client';
import { patientGuardians, patients, type Patient } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// Patient types whose share phone is the patient's own number. Minors
// (`child`/`adolescent`) instead share via the primary guardian's phone.
const MINOR_PATIENT_TYPES = new Set(['child', 'adolescent']);

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Per-row, server-resolved phone to use when sharing the consent link from the
 * "missing consent" listing. Resolved server-side (never trusting the client):
 *   - adult (individual/couple/elderly) → the patient's own phone
 *   - minor (child/adolescent)          → the primary guardian's phone
 * `sharePhone` is null when no usable phone exists for the row.
 */
export type ConsentShare = {
  patientId: string;
  sharePhone: string | null;
};

export type ListPatientsResult =
  | {
      ok: true;
      patients: Patient[];
      total: number;
      page: number;
      pageSize: number;
      // Present only when the listing was filtered by `missingConsent`. Parallel
      // to the returned `patients` page (one entry per row).
      consentShare?: ConsentShare[];
    }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Lists patients for the authenticated psychologist with filtering,
 * searching, and pagination.
 *
 * Query capabilities:
 *   - Pagination: page/pageSize (default 1/25), LIMIT/OFFSET.
 *   - Status filter: 'active' (default), 'archived', or omitted (all).
 *   - Search: partial match on full_name (accent-insensitive via unaccent),
 *     phone, or email — OR'd together.
 *   - Tags: array-contains filter (AND logic — patient must have ALL tags).
 *   - Sort: by full_name (default), created_at, or updated_at; asc/desc.
 *
 * RLS guarantees ownership scope, but we add explicit userId filter for
 * defense-in-depth.
 */
export async function listPatientsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListPatientsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate query params
  const parsed = listPatientsQuerySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const query: ListPatientsQuery = parsed.data;
  const userId = user.id;

  // 3. Build dynamic WHERE conditions
  const conditions: SQL[] = [eq(patients.userId, userId)];

  // Status filter (default: active)
  if (query.status) {
    conditions.push(eq(patients.status, query.status));
  }

  // Missing-consent filter. Mirrors the dashboard pendência count predicate
  // exactly (`isNull(consentSignedAt) AND isNull(archivedAt)`, owner-scoped) so
  // this listing's header count equals the dashboard count (RF-12.18 / RN-12.03).
  // Pushed into the shared `conditions`, so both the rows query and the count()
  // query stay consistent.
  if (query.missingConsent) {
    conditions.push(isNull(patients.consentSignedAt));
    conditions.push(isNull(patients.archivedAt));
  }

  // Search: accent-insensitive ILIKE on full_name, plain ILIKE on phone/email
  if (query.search && query.search.trim() !== '') {
    const term = query.search.trim();
    const likeTerm = `%${term}%`;

    const searchConditions: SQL[] = [
      sql`unaccent(lower(${patients.fullName})) LIKE unaccent(lower(${likeTerm}))`,
    ];

    // Phone search (plain LIKE, digits only match)
    searchConditions.push(ilike(patients.phone, likeTerm));

    // Email search (ILIKE)
    searchConditions.push(ilike(patients.email, likeTerm));

    conditions.push(or(...searchConditions)!);
  }

  // Tags filter: patient must contain ALL specified tags (AND logic via @>)
  if (query.tags && query.tags.length > 0) {
    const tagsArray = query.tags.map((t) => t.trim().toLowerCase());
    conditions.push(
      sql`${patients.tags} @> ARRAY[${sql.join(
        tagsArray.map((t) => sql`${t}`),
        sql`,`,
      )}]::text[]`,
    );
  }

  // 4. Build ORDER BY
  const sortColumnMap = {
    full_name: patients.fullName,
    created_at: patients.createdAt,
    updated_at: patients.updatedAt,
  } as const;

  const sortColumn = sortColumnMap[query.sort];
  const orderFn = query.order === 'desc' ? desc : asc;

  // 5. Execute query with pagination
  try {
    const whereClause = and(...conditions)!;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(patients)
        .where(whereClause)
        .orderBy(orderFn(sortColumn))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ count: count() }).from(patients).where(whereClause),
    ]);

    const total = totalResult[0]?.count ?? 0;

    // Row-action enrichment for the missing-consent listing: resolve the phone
    // to share the consent link with, per row, WITHOUT an N+1. Minors get the
    // primary guardian's phone via a single batched lookup; adults use their own
    // phone. Done server-side — the client never supplies the phone.
    let consentShare: ConsentShare[] | undefined;
    if (query.missingConsent) {
      consentShare = await resolveConsentShare(rows);
    }

    return {
      ok: true,
      patients: rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
      ...(consentShare ? { consentShare } : {}),
    };
  } catch (err: unknown) {
    const pgError = err as { code?: string; message?: string };
    logger.error(
      { event: 'list_patients_failed', errorCode: pgError.code },
      'unexpected error listing patients',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao listar pacientes. Tente novamente.',
    };
  }
}

/**
 * Resolves the per-row share phone for a page of missing-consent patients
 * without an N+1: adults map directly to their own phone; minors are resolved
 * via ONE batched query for their primary guardian's phone.
 *
 * The guardian query is scoped to the page's minor ids only — and those ids
 * came from an owner-scoped (and RLS-backed) patients query, so it never
 * reaches another tenant's guardians.
 */
async function resolveConsentShare(rows: Patient[]): Promise<ConsentShare[]> {
  const minorIds = rows.filter((p) => MINOR_PATIENT_TYPES.has(p.patientType)).map((p) => p.id);

  // Batched primary-guardian phone lookup for the minors on this page.
  // `is_primary DESC, created_at ASC` makes the pick deterministic: the primary
  // guardian wins, falling back to the earliest-created guardian otherwise.
  const guardianPhoneByPatientId = new Map<string, string | null>();
  if (minorIds.length > 0) {
    const guardianRows = await db
      .select({
        patientId: patientGuardians.patientId,
        phone: patientGuardians.phone,
      })
      .from(patientGuardians)
      .where(inArray(patientGuardians.patientId, minorIds))
      .orderBy(desc(patientGuardians.isPrimary), asc(patientGuardians.createdAt));

    // First row per patient wins (ordering above puts the primary guardian first).
    for (const g of guardianRows) {
      if (!guardianPhoneByPatientId.has(g.patientId)) {
        guardianPhoneByPatientId.set(g.patientId, g.phone ?? null);
      }
    }
  }

  return rows.map((p) => ({
    patientId: p.id,
    sharePhone: MINOR_PATIENT_TYPES.has(p.patientType)
      ? (guardianPhoneByPatientId.get(p.id) ?? null)
      : (p.phone ?? null),
  }));
}
