import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

import { listPatientsQuerySchema } from '@/modules/patients/lib/patient-input-schema';
import type { ListPatientsQuery } from '@/modules/patients/lib/patient-types';
import { db } from '@/shared/db/client';
import { patients, type Patient } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ListPatientsResult =
  | {
      ok: true;
      patients: Patient[];
      total: number;
      page: number;
      pageSize: number;
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

    return {
      ok: true,
      patients: rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
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
