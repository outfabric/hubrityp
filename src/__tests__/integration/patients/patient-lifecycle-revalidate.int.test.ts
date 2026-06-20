import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// These tests exercise the route-shell Server Actions in
// `src/app/(app)/pacientes/[id]/actions.ts` directly (not the impls), because
// the `revalidatePath` invocation we want to assert lives in the wrappers, not
// in the impls. The impls hit real Postgres via Testcontainers; we mock only
// the two boundary modules that cannot run inside Vitest:
//   - `@/shared/supabase/server` — supplies a fake auth-only client (no cookies).
//   - `next/cache` — `revalidatePath` requires a Next.js request scope.
// Everything else (Drizzle, the ownership/status guards) runs against real DB.
// ---------------------------------------------------------------------------

const revalidatePathMock = vi.fn<(path: string, type?: 'page' | 'layout') => void>();

vi.mock('next/cache', () => ({
  // Forward the exact argument arity so `toHaveBeenCalledWith('/pacientes')`
  // (single-arg listing invalidation) and `(..., 'page')` (detail) both match.
  revalidatePath: (...args: [string, ('page' | 'layout')?]) => {
    revalidatePathMock(...args);
  },
}));

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(
  userId: string,
  patientId: string,
  overrides: Partial<{ status: string; archivedAt: Date }> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: 'individual',
      status: overrides.status ?? 'active',
      archivedAt: overrides.archivedAt ?? null,
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Dynamic imports — load the action wrappers and the mocked client factory
// AFTER the mocks above are registered.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/consistent-type-imports */
let archivePatient: typeof import('@/app/(app)/pacientes/[id]/actions').archivePatient;
let unarchivePatient: typeof import('@/app/(app)/pacientes/[id]/actions').unarchivePatient;
let deletePatient: typeof import('@/app/(app)/pacientes/[id]/actions').deletePatient;
let createServerClient: typeof import('@/shared/supabase/server').createServerClient;
/* eslint-enable @typescript-eslint/consistent-type-imports */

beforeEach(async () => {
  revalidatePathMock.mockClear();

  const actions = await import('@/app/(app)/pacientes/[id]/actions');
  archivePatient = actions.archivePatient;
  unarchivePatient = actions.unarchivePatient;
  deletePatient = actions.deletePatient;

  const supabaseModule = await import('@/shared/supabase/server');
  createServerClient = supabaseModule.createServerClient;
});

afterEach(async () => {
  vi.clearAllMocks();
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

function wireClient(userId: string | null): void {
  vi.mocked(createServerClient).mockResolvedValue(
    fakeSupabaseClient(userId) as unknown as Awaited<ReturnType<typeof createServerClient>>,
  );
}

// ---------------------------------------------------------------------------
// archivePatient → unarchivePatient transition
// ---------------------------------------------------------------------------

describe('patient lifecycle Server Actions — DB transitions + revalidatePath', () => {
  it('archives an active patient then unarchives it (status/archived_at round-trip)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    wireClient(userId);

    // --- Archive ---
    const archiveResult = await archivePatient(patientId);
    expect(archiveResult.ok).toBe(true);

    const archivedRows = await runAsService(async (db) =>
      db.select().from(patients).where(eq(patients.id, patientId)),
    );
    expect(archivedRows).toHaveLength(1);
    expect(archivedRows[0]!.status).toBe('archived');
    expect(archivedRows[0]!.archivedAt).not.toBeNull();

    // Listing + detail caches invalidated.
    expect(revalidatePathMock).toHaveBeenCalledWith('/pacientes');
    expect(revalidatePathMock).toHaveBeenCalledWith(`/pacientes/${patientId}`, 'page');

    revalidatePathMock.mockClear();

    // --- Unarchive ---
    const unarchiveResult = await unarchivePatient(patientId);
    expect(unarchiveResult.ok).toBe(true);

    const activeRows = await runAsService(async (db) =>
      db.select().from(patients).where(eq(patients.id, patientId)),
    );
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]!.status).toBe('active');
    expect(activeRows[0]!.archivedAt).toBeNull();

    expect(revalidatePathMock).toHaveBeenCalledWith('/pacientes');
    expect(revalidatePathMock).toHaveBeenCalledWith(`/pacientes/${patientId}`, 'page');
  });

  it('does not revalidate when archive is rejected with already_archived', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, { status: 'archived', archivedAt: new Date() });
    wireClient(userId);

    const result = await archivePatient(patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_archived');

    // No mutation succeeded → no cache invalidation.
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('does not revalidate when unarchive is rejected with not_archived', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId); // active
    wireClient(userId);

    const result = await unarchivePatient(patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_archived');

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('deletes a patient and revalidates only the listing', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    wireClient(userId);

    const result = await deletePatient(patientId);
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) =>
      db.select().from(patients).where(eq(patients.id, patientId)),
    );
    expect(rows).toHaveLength(0);

    expect(revalidatePathMock).toHaveBeenCalledWith('/pacientes');
    // Detail route is gone — only the listing is invalidated.
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
  });

  it('does not revalidate when delete targets another user (not_found)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    wireClient(userB);

    const result = await deletePatient(patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');

    expect(revalidatePathMock).not.toHaveBeenCalled();

    // Owner's row untouched.
    const rows = await runAsService(async (db) =>
      db.select().from(patients).where(eq(patients.id, patientId)),
    );
    expect(rows).toHaveLength(1);
  });
});
