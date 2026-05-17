import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createEvolutionImpl } from '@/modules/medical-records/server/create-evolution';
import { getEvolutionDetailImpl } from '@/modules/medical-records/server/get-evolution-detail';
import { getEvolutionsByPatientImpl } from '@/modules/medical-records/server/get-evolutions-by-patient';
import { listEvolutionVersionsImpl } from '@/modules/medical-records/server/list-evolution-versions';
import { updateEvolutionImpl } from '@/modules/medical-records/server/update-evolution';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { auditLog, evolutions, evolutionVersions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Helpers
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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Patient Test',
      status: 'active',
    });
  });
}

async function seedSession(userId: string, patientId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: oneHourLater,
      durationMinutes: 60,
      status: 'confirmed',
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
  } as Parameters<typeof createEvolutionImpl>[0];
}

const VALID_TCC_CONTENT = {
  humor_inicial: 7,
  humor_final: 8,
  pauta_sessao: 'Ansiedade generalizada',
  conteudo_trabalhado: 'Reestruturação cognitiva',
  tarefa_casa_atribuida: 'Registro de pensamentos',
  tarefa_anterior_status: 'sim' as const,
  proximos_passos: 'Revisão da tarefa na próxima sessão',
};

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(auditLog);
    await db.delete(evolutionVersions);
    await db.delete(evolutions);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// createEvolutionImpl
// ---------------------------------------------------------------------------

describe('createEvolutionImpl', () => {
  it('creates an evolution row + version v1 successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, patientId, sessionId);

    const result = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      sessionId,
      templateType: 'tcc',
      content: VALID_TCC_CONTENT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBeDefined();

    // Verify evolution row
    const evoRows = await runAsService(async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, result.id));
    });
    expect(evoRows).toHaveLength(1);
    expect(evoRows[0]!.userId).toBe(userId);
    expect(evoRows[0]!.patientId).toBe(patientId);
    expect(evoRows[0]!.sessionId).toBe(sessionId);
    expect(evoRows[0]!.templateType).toBe('tcc');
    expect(evoRows[0]!.currentVersion).toBe(1);
    expect(evoRows[0]!.content).toEqual(VALID_TCC_CONTENT);

    // Verify version row
    const verRows = await runAsService(async (db) => {
      return db
        .select()
        .from(evolutionVersions)
        .where(eq(evolutionVersions.evolutionId, result.id));
    });
    expect(verRows).toHaveLength(1);
    expect(verRows[0]!.versionNumber).toBe(1);
    expect(verRows[0]!.isAddendum).toBe(false);
    expect(verRows[0]!.modifiedBy).toBe(userId);
    expect(verRows[0]!.content).toEqual(VALID_TCC_CONTENT);
  });

  it('writes audit_log entry on creation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Sessão produtiva' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.action).toBe('evolution.create');
    expect(auditRows[0]!.resourceType).toBe('evolution');
    expect(auditRows[0]!.resourceId).toBe(result.id);
  });

  it('rejects duplicate session_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, patientId, sessionId);

    // First creation succeeds
    const first = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      sessionId,
      templateType: 'livre',
      content: { conteudo: 'Primeira evolução' },
    });
    expect(first.ok).toBe(true);

    // Second creation with same sessionId fails
    const second = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      sessionId,
      templateType: 'livre',
      content: { conteudo: 'Segunda evolução' },
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('DUPLICATE_SESSION');
  });

  it('returns INVALID_TEMPLATE for bad template type', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'nonexistent',
      content: { foo: 'bar' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TEMPLATE');
  });

  it('returns INVALID_TEMPLATE for content that does not match schema', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'tcc',
      content: { humor_inicial: 'not_a_number' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TEMPLATE');
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const result = await createEvolutionImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
      templateType: 'livre',
      content: { conteudo: 'test' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('allows creation without sessionId (optional)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Sem sessão vinculada' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const evoRows = await runAsService(async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, result.id));
    });
    expect(evoRows[0]!.sessionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateEvolutionImpl — within 30-day window
// ---------------------------------------------------------------------------

describe('updateEvolutionImpl (within edit window)', () => {
  it('updates content and creates a new version (is_addendum=false)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create an evolution
    const createResult = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Original content' },
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Update within window
    const updateResult = await updateEvolutionImpl(fakeSupabaseClient(userId), {
      evolutionId: createResult.id,
      content: { conteudo: 'Updated content' },
    });

    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.version).toBe(2);
    expect(updateResult.isAddendum).toBe(false);

    // Verify evolution content was updated
    const evoRows = await runAsService(async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, createResult.id));
    });
    expect(evoRows[0]!.content).toEqual({ conteudo: 'Updated content' });
    expect(evoRows[0]!.currentVersion).toBe(2);

    // Verify version v2 was created (not addendum)
    const verRows = await runAsService(async (db) => {
      return db
        .select()
        .from(evolutionVersions)
        .where(eq(evolutionVersions.evolutionId, createResult.id));
    });
    expect(verRows).toHaveLength(2);
    const v2 = verRows.find((v) => v.versionNumber === 2);
    expect(v2).toBeDefined();
    expect(v2!.isAddendum).toBe(false);
    expect(v2!.content).toEqual({ conteudo: 'Updated content' });
  });

  it('returns NOT_FOUND for evolution owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User A creates an evolution
    const createResult = await createEvolutionImpl(fakeSupabaseClient(userA), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'User A content' },
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to update it
    const updateResult = await updateEvolutionImpl(fakeSupabaseClient(userB), {
      evolutionId: createResult.id,
      content: { conteudo: 'Hijacked!' },
    });

    expect(updateResult.ok).toBe(false);
    if (updateResult.ok) return;
    expect(updateResult.code).toBe('NOT_FOUND');

    // Verify original content unchanged
    const evoRows = await runAsService(async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, createResult.id));
    });
    expect(evoRows[0]!.content).toEqual({ conteudo: 'User A content' });
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const result = await updateEvolutionImpl(fakeSupabaseClient(null), {
      evolutionId: randomUUID(),
      content: { conteudo: 'test' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// updateEvolutionImpl — past 30-day window (addendum mode)
// ---------------------------------------------------------------------------

describe('updateEvolutionImpl (past edit window — addendum)', () => {
  it('creates addendum version (is_addendum=true) and does NOT update original content', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Insert evolution with created_at 31 days ago to trigger addendum mode
    const evolutionId = randomUUID();
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evolutionId,
        userId,
        patientId,
        templateType: 'livre',
        content: { conteudo: 'Original immutable content' },
        currentVersion: 1,
        createdAt: thirtyOneDaysAgo,
        updatedAt: thirtyOneDaysAgo,
      });
      await db.insert(evolutionVersions).values({
        evolutionId,
        versionNumber: 1,
        content: { conteudo: 'Original immutable content' },
        isAddendum: false,
        modifiedBy: userId,
      });
    });

    // Attempt update with reason
    const updateResult = await updateEvolutionImpl(fakeSupabaseClient(userId), {
      evolutionId,
      content: { conteudo: 'Addendum: correction to original' },
      reason: 'Correção de informação clínica',
    });

    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.version).toBe(2);
    expect(updateResult.isAddendum).toBe(true);

    // Verify original content NOT updated
    const evoRows = await runAsService(async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, evolutionId));
    });
    expect(evoRows[0]!.content).toEqual({ conteudo: 'Original immutable content' });
    expect(evoRows[0]!.currentVersion).toBe(2);
    expect(evoRows[0]!.finalizedAt).not.toBeNull();

    // Verify addendum version
    const verRows = await runAsService(async (db) => {
      return db
        .select()
        .from(evolutionVersions)
        .where(eq(evolutionVersions.evolutionId, evolutionId));
    });
    const addendum = verRows.find((v) => v.versionNumber === 2);
    expect(addendum).toBeDefined();
    expect(addendum!.isAddendum).toBe(true);
    expect(addendum!.reason).toBe('Correção de informação clínica');
    expect(addendum!.content).toEqual({ conteudo: 'Addendum: correction to original' });
  });

  it('returns REASON_REQUIRED when past window and no reason provided', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const evolutionId = randomUUID();
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evolutionId,
        userId,
        patientId,
        templateType: 'livre',
        content: { conteudo: 'Original' },
        currentVersion: 1,
        createdAt: thirtyOneDaysAgo,
        updatedAt: thirtyOneDaysAgo,
      });
    });

    const updateResult = await updateEvolutionImpl(fakeSupabaseClient(userId), {
      evolutionId,
      content: { conteudo: 'No reason' },
    });

    expect(updateResult.ok).toBe(false);
    if (updateResult.ok) return;
    expect(updateResult.code).toBe('REASON_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// RLS negative test: psychologist B cannot read psychologist A's evolutions
// ---------------------------------------------------------------------------

describe('RLS negative: cross-tenant isolation', () => {
  it('psychologist B cannot read psychologist A evolutions via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const evolutionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Seed evolution for user A
    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evolutionId,
        userId: userA,
        patientId,
        templateType: 'livre',
        content: { conteudo: 'Confidential' },
        currentVersion: 1,
      });
    });

    // User B queries evolutions via RLS — should see nothing
    const visibleToB = await runAsUser(userB, async (db) => {
      return db.select().from(evolutions);
    });
    expect(visibleToB).toHaveLength(0);

    // User A queries evolutions via RLS — should see their own
    const visibleToA = await runAsUser(userA, async (db) => {
      return db.select().from(evolutions);
    });
    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]!.id).toBe(evolutionId);
  });

  it('psychologist B cannot read psychologist A evolution via getEvolutionDetail', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User A creates an evolution
    const createResult = await createEvolutionImpl(fakeSupabaseClient(userA), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Secret data' },
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to read it
    const detailResult = await getEvolutionDetailImpl(fakeSupabaseClient(userB), {
      evolutionId: createResult.id,
    });
    expect(detailResult.ok).toBe(false);
    if (detailResult.ok) return;
    expect(detailResult.code).toBe('NOT_FOUND');
  });

  it('psychologist B cannot list psychologist A evolutions via getEvolutionsByPatient', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User A creates an evolution
    await createEvolutionImpl(fakeSupabaseClient(userA), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Secret' },
    });

    // User B tries to list evolutions for user A's patient
    const listResult = await getEvolutionsByPatientImpl(fakeSupabaseClient(userB), {
      patientId,
    });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.evolutions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getEvolutionsByPatient
// ---------------------------------------------------------------------------

describe('getEvolutionsByPatientImpl', () => {
  it('returns paginated list ordered by created_at DESC', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create 3 evolutions
    for (let i = 0; i < 3; i++) {
      await createEvolutionImpl(fakeSupabaseClient(userId), {
        patientId,
        templateType: 'livre',
        content: { conteudo: `Evolution ${i}` },
      });
      // Small delay to ensure different created_at timestamps
      await new Promise((r) => setTimeout(r, 10));
    }

    const result = await getEvolutionsByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
      limit: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evolutions).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();

    // Verify DESC ordering
    const first = result.evolutions[0]!;
    const second = result.evolutions[1]!;
    expect(first.createdAt.getTime()).toBeGreaterThan(second.createdAt.getTime());
  });

  it('writes audit_log prontuario.read on successful fetch', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await getEvolutionsByPatientImpl(fakeSupabaseClient(userId), { patientId });

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    const readEntry = auditRows.find((r) => r.action === 'prontuario.read');
    expect(readEntry).toBeDefined();
    expect(readEntry!.resourceType).toBe('patient');
    expect(readEntry!.resourceId).toBe(patientId);
  });
});

// ---------------------------------------------------------------------------
// getEvolutionDetailImpl
// ---------------------------------------------------------------------------

describe('getEvolutionDetailImpl', () => {
  it('returns full evolution content for owner', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const createResult = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'tcc',
      content: VALID_TCC_CONTENT,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const detailResult = await getEvolutionDetailImpl(fakeSupabaseClient(userId), {
      evolutionId: createResult.id,
    });

    expect(detailResult.ok).toBe(true);
    if (!detailResult.ok) return;
    expect(detailResult.evolution.id).toBe(createResult.id);
    expect(detailResult.evolution.content).toEqual(VALID_TCC_CONTENT);
    expect(detailResult.evolution.templateType).toBe('tcc');
  });

  it('writes audit_log evolution.read on successful fetch', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const createResult = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Test' },
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Clear previous audit entries (from creation)
    await runAsService(async (db) => {
      await db.delete(auditLog);
    });

    await getEvolutionDetailImpl(fakeSupabaseClient(userId), {
      evolutionId: createResult.id,
    });

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.action).toBe('evolution.read');
    expect(auditRows[0]!.resourceType).toBe('evolution');
    expect(auditRows[0]!.resourceId).toBe(createResult.id);
  });
});

// ---------------------------------------------------------------------------
// listEvolutionVersionsImpl
// ---------------------------------------------------------------------------

describe('listEvolutionVersionsImpl', () => {
  it('returns versions ordered by version_number DESC', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create an evolution and update it twice
    const createResult = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'V1' },
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await updateEvolutionImpl(fakeSupabaseClient(userId), {
      evolutionId: createResult.id,
      content: { conteudo: 'V2' },
    });
    await updateEvolutionImpl(fakeSupabaseClient(userId), {
      evolutionId: createResult.id,
      content: { conteudo: 'V3' },
    });

    const versionsResult = await listEvolutionVersionsImpl(fakeSupabaseClient(userId), {
      evolutionId: createResult.id,
    });

    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    expect(versionsResult.versions).toHaveLength(3);
    expect(versionsResult.versions[0]!.versionNumber).toBe(3);
    expect(versionsResult.versions[1]!.versionNumber).toBe(2);
    expect(versionsResult.versions[2]!.versionNumber).toBe(1);
  });

  it('returns NOT_FOUND for evolution owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    const createResult = await createEvolutionImpl(fakeSupabaseClient(userA), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Secret' },
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const versionsResult = await listEvolutionVersionsImpl(fakeSupabaseClient(userB), {
      evolutionId: createResult.id,
    });

    expect(versionsResult.ok).toBe(false);
    if (versionsResult.ok) return;
    expect(versionsResult.code).toBe('NOT_FOUND');
  });
});
