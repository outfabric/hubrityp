import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { generateConsentImpl } from '@/modules/patients/server/generate-consent';
import { getConsentStatusImpl } from '@/modules/patients/server/get-consent-status';
import { revokeConsentImpl } from '@/modules/patients/server/revoke-consent';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a row in `auth.users` so the FK constraint on `patients.user_id` is
 * satisfied. Same pattern as other integration tests.
 */
async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

/**
 * Create a patient owned by `userId`.
 */
async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
    });
  });
}

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. Isolates the server action logic from GoTrue.
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
  } as Parameters<typeof generateConsentImpl>[0];
}

/**
 * Simulate signing a consent term directly in the DB (the actual signing
 * flow is implemented in section 4 — here we set the fields manually to
 * test revocation and status transitions).
 */
async function simulateSign(consentId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db
      .update(consentTerms)
      .set({
        signedAt: dsql`now()`,
        signedIp: '127.0.0.1',
        signedUserAgent: 'test-agent',
      })
      .where(eq(consentTerms.id, consentId));

    await db
      .update(patients)
      .set({ consentSignedAt: dsql`now()` })
      .where(eq(patients.id, patientId));
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(consentTerms);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// generateConsentImpl
// ---------------------------------------------------------------------------

describe('generateConsentImpl', () => {
  it('generates a consent term with a valid 64-char hex token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await generateConsentImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consentId).toBeDefined();
    expect(result.token).toBeDefined();

    // Token must be exactly 64 hex characters (256 bits)
    expect(result.token).toHaveLength(64);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persists the consent term in the database with correct fields', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await generateConsentImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, result.consentId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.patientId).toBe(patientId);
    expect(row.userId).toBe(userId);
    expect(row.signatureToken).toBe(result.token);
    expect(row.termText).toBeTruthy();
    expect(row.signedAt).toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('generates unique tokens across multiple calls', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    const result1 = await generateConsentImpl(client, patientId);
    const result2 = await generateConsentImpl(client, patientId);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;

    expect(result1.token).not.toBe(result2.token);
    expect(result1.consentId).not.toBe(result2.consentId);
  });

  it('allows multiple consent terms for the same patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    await generateConsentImpl(client, patientId);
    await generateConsentImpl(client, patientId);
    await generateConsentImpl(client, patientId);

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });

    expect(rows).toHaveLength(3);
  });

  it('returns patient_not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await generateConsentImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns patient_not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User B tries to generate consent for User A's patient
    const client = fakeSupabaseClient(userB);
    const result = await generateConsentImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');

    // Verify no consent term was created
    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });
    expect(rows).toHaveLength(0);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await generateConsentImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('populates term_text with default template content', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await generateConsentImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, result.consentId));
    });

    // The template should contain LGPD reference (key legal requirement)
    expect(rows[0]!.termText).toContain('Lei Geral de Proteção de Dados');
  });
});

// ---------------------------------------------------------------------------
// revokeConsentImpl
// ---------------------------------------------------------------------------

describe('revokeConsentImpl', () => {
  it('revokes a signed consent term and clears patient.consent_signed_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Generate and simulate signing
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    await simulateSign(genResult.consentId, patientId);

    // Verify patient has consent_signed_at set before revocation
    const beforeRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(beforeRows[0]!.consentSignedAt).not.toBeNull();

    // Revoke
    const revokeResult = await revokeConsentImpl(client, patientId);
    expect(revokeResult.ok).toBe(true);

    // Verify consent_terms.revoked_at is set
    const termRows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, genResult.consentId));
    });
    expect(termRows[0]!.revokedAt).toBeInstanceOf(Date);

    // Verify patient.consent_signed_at is cleared
    const afterRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(afterRows[0]!.consentSignedAt).toBeNull();
    expect(afterRows[0]!.consentRevokedAt).toBeInstanceOf(Date);
  });

  it('returns no_active_consent when no signed consent exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Generate but do NOT sign
    await generateConsentImpl(client, patientId);

    const result = await revokeConsentImpl(client, patientId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_active_consent');
  });

  it('returns no_active_consent when consent is already revoked', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Generate, sign, then revoke
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    await simulateSign(genResult.consentId, patientId);

    const firstRevoke = await revokeConsentImpl(client, patientId);
    expect(firstRevoke.ok).toBe(true);

    // Try to revoke again — should fail
    const secondRevoke = await revokeConsentImpl(client, patientId);
    expect(secondRevoke.ok).toBe(false);
    if (secondRevoke.ok) return;
    expect(secondRevoke.error).toBe('no_active_consent');
  });

  it('returns no_active_consent when no consent terms exist at all', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await revokeConsentImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_active_consent');
  });

  it('returns patient_not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await revokeConsentImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns patient_not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    const clientA = fakeSupabaseClient(userA);
    const genResult = await generateConsentImpl(clientA, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;
    await simulateSign(genResult.consentId, patientId);

    // User B tries to revoke User A's patient's consent
    const clientB = fakeSupabaseClient(userB);
    const result = await revokeConsentImpl(clientB, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await revokeConsentImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// getConsentStatusImpl
// ---------------------------------------------------------------------------

describe('getConsentStatusImpl', () => {
  it('returns "pending" when no consent terms exist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await getConsentStatusImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.status).toBe('pending');
    expect(result.consent.signedAt).toBeNull();
    expect(result.consent.revokedAt).toBeNull();
    expect(result.consent.signedPdfPath).toBeNull();
    expect(result.consent.consentId).toBeNull();
    expect(result.consent.token).toBeNull();
  });

  it('returns "pending" when consent is generated but not signed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    const result = await getConsentStatusImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.status).toBe('pending');
    expect(result.consent.consentId).toBe(genResult.consentId);
    expect(result.consent.token).toBe(genResult.token);
  });

  it('returns "signed" when consent is signed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    await simulateSign(genResult.consentId, patientId);

    const result = await getConsentStatusImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.status).toBe('signed');
    expect(result.consent.signedAt).toBeInstanceOf(Date);
    expect(result.consent.revokedAt).toBeNull();
    expect(result.consent.consentId).toBe(genResult.consentId);
  });

  it('returns "revoked" when consent is revoked', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    await simulateSign(genResult.consentId, patientId);
    await revokeConsentImpl(client, patientId);

    const result = await getConsentStatusImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.status).toBe('revoked');
    expect(result.consent.signedAt).toBeInstanceOf(Date);
    expect(result.consent.revokedAt).toBeInstanceOf(Date);
    expect(result.consent.consentId).toBe(genResult.consentId);
  });

  it('returns patient_not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await getConsentStatusImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns patient_not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    const clientB = fakeSupabaseClient(userB);
    const result = await getConsentStatusImpl(clientB, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getConsentStatusImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('reflects the correct status after generate -> sign -> revoke -> generate cycle', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // 1. Initially pending (no terms)
    const status1 = await getConsentStatusImpl(client, patientId);
    expect(status1.ok).toBe(true);
    if (!status1.ok) return;
    expect(status1.consent.status).toBe('pending');

    // 2. Generate -> still pending (not signed)
    const gen1 = await generateConsentImpl(client, patientId);
    expect(gen1.ok).toBe(true);
    if (!gen1.ok) return;

    const status2 = await getConsentStatusImpl(client, patientId);
    expect(status2.ok).toBe(true);
    if (!status2.ok) return;
    expect(status2.consent.status).toBe('pending');

    // 3. Sign -> signed
    await simulateSign(gen1.consentId, patientId);

    const status3 = await getConsentStatusImpl(client, patientId);
    expect(status3.ok).toBe(true);
    if (!status3.ok) return;
    expect(status3.consent.status).toBe('signed');

    // 4. Revoke -> revoked
    await revokeConsentImpl(client, patientId);

    const status4 = await getConsentStatusImpl(client, patientId);
    expect(status4.ok).toBe(true);
    if (!status4.ok) return;
    expect(status4.consent.status).toBe('revoked');

    // 5. Generate new -> pending (new term, unsigned)
    const gen2 = await generateConsentImpl(client, patientId);
    expect(gen2.ok).toBe(true);
    if (!gen2.ok) return;

    const status5 = await getConsentStatusImpl(client, patientId);
    expect(status5.ok).toBe(true);
    if (!status5.ok) return;
    // The latest term is the unsigned one, patient.consent_signed_at is null
    expect(status5.consent.status).toBe('pending');
    expect(status5.consent.consentId).toBe(gen2.consentId);
    expect(status5.consent.token).toBe(gen2.token);
  });
});
