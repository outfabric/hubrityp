import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { phoneNumberSchema } from '@/modules/whatsapp/lib/phone-number-schema';
import { updatePatientWhatsappOptOutImpl } from '@/modules/whatsapp/server/update-patient-whatsapp-opt-out';
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

async function seedPatient(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const patientId = randomUUID();
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Paciente Teste',
      patientType: 'individual',
      ...overrides,
    });
  });
  return patientId;
}

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. Isolates the server action from the real Supabase Auth
 * service (GoTrue not running in Testcontainers).
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof updatePatientWhatsappOptOutImpl>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Toggle opt-out
// ---------------------------------------------------------------------------

describe('updatePatientWhatsappOptOutImpl — toggle opt-out', () => {
  it('sets whatsapp_opt_out=true and records timestamp', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const patientId = await seedPatient(userId);

    const client = fakeSupabaseClient(userId);
    const result = await updatePatientWhatsappOptOutImpl(client, {
      patient_id: patientId,
      whatsapp_opt_out: true,
    });

    expect(result).toEqual({ ok: true });

    // Verify DB state
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.whatsappOptOut).toBe(true);
    expect(rows[0]!.whatsappOptOutAt).toBeInstanceOf(Date);
  });

  it('clears opt-out when toggled back to false', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    // Seed patient already opted out
    const patientId = await seedPatient(userId, {
      whatsappOptOut: true,
      whatsappOptOutAt: new Date(),
    });

    const client = fakeSupabaseClient(userId);
    const result = await updatePatientWhatsappOptOutImpl(client, {
      patient_id: patientId,
      whatsapp_opt_out: false,
    });

    expect(result).toEqual({ ok: true });

    // Verify DB state
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.whatsappOptOut).toBe(false);
    expect(rows[0]!.whatsappOptOutAt).toBeNull();
  });

  it('accepts optional opt_out_reason without error', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const patientId = await seedPatient(userId);

    const client = fakeSupabaseClient(userId);
    const result = await updatePatientWhatsappOptOutImpl(client, {
      patient_id: patientId,
      whatsapp_opt_out: true,
      opt_out_reason: 'Paciente solicitou por escrito.',
    });

    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Auth & authorization
// ---------------------------------------------------------------------------

describe('updatePatientWhatsappOptOutImpl — auth', () => {
  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await updatePatientWhatsappOptOutImpl(client, {
      patient_id: randomUUID(),
      whatsapp_opt_out: true,
    });

    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('returns not_found when patient does not exist', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await updatePatientWhatsappOptOutImpl(client, {
      patient_id: randomUUID(),
      whatsapp_opt_out: true,
    });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// RLS cross-user isolation
// ---------------------------------------------------------------------------

describe('updatePatientWhatsappOptOutImpl — RLS cross-user', () => {
  it('psychologist A cannot update opt-out of patient belonging to psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    // Patient belongs to user B
    const patientId = await seedPatient(userIdB);

    // User A tries to opt-out user B's patient
    const clientA = fakeSupabaseClient(userIdA);
    const result = await updatePatientWhatsappOptOutImpl(clientA, {
      patient_id: patientId,
      whatsapp_opt_out: true,
    });

    // Should return not_found (no information leakage)
    expect(result).toEqual({ ok: false, error: 'not_found' });

    // Verify patient was NOT modified
    const rows = await runAsService(async (db) => {
      return db
        .select({ whatsappOptOut: patients.whatsappOptOut })
        .from(patients)
        .where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.whatsappOptOut).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('updatePatientWhatsappOptOutImpl — input validation', () => {
  it('rejects invalid patient_id (not a UUID)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await updatePatientWhatsappOptOutImpl(client, {
      patient_id: 'not-a-uuid',
      whatsapp_opt_out: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_input');
    }
  });

  it('rejects missing whatsapp_opt_out field', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await updatePatientWhatsappOptOutImpl(client, {
      patient_id: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_input');
    }
  });
});

// ---------------------------------------------------------------------------
// reminder_phone E.164 validation
// ---------------------------------------------------------------------------

describe('reminder_phone — E.164 format', () => {
  it('accepts valid E.164 reminder_phone stored in DB', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const patientId = await seedPatient(userId, {
      reminderPhone: '+5511999887766',
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.reminderPhone).toBe('+5511999887766');
  });

  it('rejects invalid phone format via phoneNumberSchema', () => {
    // E.164 validation happens at the application layer via Zod schema,
    // not via a DB CHECK constraint.
    const validResult = phoneNumberSchema.safeParse('+5511999887766');
    expect(validResult.success).toBe(true);

    const invalidResult = phoneNumberSchema.safeParse('invalid-phone');
    expect(invalidResult.success).toBe(false);

    const shortResult = phoneNumberSchema.safeParse('+55');
    expect(shortResult.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defaults for new patient
// ---------------------------------------------------------------------------

describe('patient defaults — whatsapp opt-out fields', () => {
  it('new patient has whatsapp_opt_out=false, whatsapp_opt_out_at=null, reminder_phone=null', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const patientId = await seedPatient(userId);

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.whatsappOptOut).toBe(false);
    expect(rows[0]!.whatsappOptOutAt).toBeNull();
    expect(rows[0]!.reminderPhone).toBeNull();
  });
});
