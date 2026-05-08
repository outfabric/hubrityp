import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createCouplePatientImpl } from '@/modules/patients/server/create-couple-patient';
import { getCouplePartnerImpl } from '@/modules/patients/server/get-couple-partner';
import { unlinkCoupleImpl } from '@/modules/patients/server/unlink-couple';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

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

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createCouplePatientImpl>[0];
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// createCouplePatientImpl
// ---------------------------------------------------------------------------

describe('createCouplePatientImpl', () => {
  it('creates two patients with the same couple_id and patient_type="couple"', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createCouplePatientImpl(
      client,
      { fullName: 'Ana Costa' },
      { fullName: 'Bruno Costa' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.patientAId).toBeDefined();
    expect(result.patientBId).toBeDefined();
    expect(result.coupleId).toBeDefined();
    expect(result.patientAId).not.toBe(result.patientBId);

    // Verify both rows in DB share the same couple_id
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.coupleId, result.coupleId));
    });

    expect(rows).toHaveLength(2);

    const names = rows.map((r) => r.fullName).sort();
    expect(names).toEqual(['Ana Costa', 'Bruno Costa']);

    for (const row of rows) {
      expect(row.patientType).toBe('couple');
      expect(row.coupleId).toBe(result.coupleId);
      expect(row.userId).toBe(userId);
      expect(row.status).toBe('active');
    }
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await createCouplePatientImpl(
      client,
      { fullName: 'Ana' },
      { fullName: 'Bruno' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('returns invalid_input_a when partner A data is invalid', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createCouplePatientImpl(
      client,
      {}, // missing fullName
      { fullName: 'Bruno' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input_a');
  });

  it('returns invalid_input_b when partner B data is invalid', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createCouplePatientImpl(
      client,
      { fullName: 'Ana' },
      {}, // missing fullName
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input_b');
  });

  it('creates patients with optional fields filled', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createCouplePatientImpl(
      client,
      {
        fullName: 'Ana Costa',
        phone: '+55 11 91234-5678',
        email: 'ana@example.com',
      },
      {
        fullName: 'Bruno Costa',
        phone: '+55 11 99876-5432',
        email: 'bruno@example.com',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.coupleId, result.coupleId));
    });

    const ana = rows.find((r) => r.fullName === 'Ana Costa');
    const bruno = rows.find((r) => r.fullName === 'Bruno Costa');

    expect(ana!.phone).toBe('+55 11 91234-5678');
    expect(ana!.email).toBe('ana@example.com');
    expect(bruno!.phone).toBe('+55 11 99876-5432');
    expect(bruno!.email).toBe('bruno@example.com');
  });
});

// ---------------------------------------------------------------------------
// unlinkCoupleImpl
// ---------------------------------------------------------------------------

describe('unlinkCoupleImpl', () => {
  it('unlinks both patients: sets couple_id to null and patient_type to individual', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create a couple first
    const createResult = await createCouplePatientImpl(
      client,
      { fullName: 'Ana Costa' },
      { fullName: 'Bruno Costa' },
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Unlink using patient A's ID
    const unlinkResult = await unlinkCoupleImpl(client, createResult.patientAId);
    expect(unlinkResult.ok).toBe(true);

    // Verify both patients are now unlinked
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.coupleId).toBeNull();
      expect(row.patientType).toBe('individual');
    }
  });

  it('returns no_couple when patient has no couple_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    // Seed an individual patient (no couple_id)
    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Solo Patient',
        patientType: 'individual',
        status: 'active',
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await unlinkCoupleImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_couple');
  });

  it('returns not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await unlinkCoupleImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Create couple for user A
    const clientA = fakeSupabaseClient(userA);
    const createResult = await createCouplePatientImpl(
      clientA,
      { fullName: 'Ana' },
      { fullName: 'Bruno' },
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to unlink user A's patient
    const clientB = fakeSupabaseClient(userB);
    const result = await unlinkCoupleImpl(clientB, createResult.patientAId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await unlinkCoupleImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// getCouplePartnerImpl
// ---------------------------------------------------------------------------

describe('getCouplePartnerImpl', () => {
  it('returns the partner for a coupled patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const createResult = await createCouplePatientImpl(
      client,
      { fullName: 'Ana Costa' },
      { fullName: 'Bruno Costa' },
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Get partner of patient A -> should be patient B
    const resultA = await getCouplePartnerImpl(client, createResult.patientAId);
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.partner.id).toBe(createResult.patientBId);
    expect(resultA.partner.fullName).toBe('Bruno Costa');

    // Get partner of patient B -> should be patient A
    const resultB = await getCouplePartnerImpl(client, createResult.patientBId);
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.partner.id).toBe(createResult.patientAId);
    expect(resultB.partner.fullName).toBe('Ana Costa');
  });

  it('returns no_partner for a patient without couple_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Solo Patient',
        patientType: 'individual',
        status: 'active',
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await getCouplePartnerImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_partner');
  });

  it('returns not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await getCouplePartnerImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const clientA = fakeSupabaseClient(userA);
    const createResult = await createCouplePatientImpl(
      clientA,
      { fullName: 'Ana' },
      { fullName: 'Bruno' },
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to get partner of user A's patient
    const clientB = fakeSupabaseClient(userB);
    const result = await getCouplePartnerImpl(clientB, createResult.patientAId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getCouplePartnerImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});
