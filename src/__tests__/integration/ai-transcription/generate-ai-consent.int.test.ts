import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { generateAiConsentTermImpl } from '@/modules/patients/server/generate-ai-consent';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

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
  } as Parameters<typeof generateAiConsentTermImpl>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(consentTerms);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateAiConsentTermImpl — real Postgres', () => {
  it('generates an ai_recording consent term with a valid base64url token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await generateAiConsentTermImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publicUrl).toMatch(/^\/termo\/.+$/);
    expect(result.expiresAt).toBeInstanceOf(Date);

    // Token is 43-char base64url (32 bytes)
    const token = result.publicUrl.replace('/termo/', '');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('persists the consent term in the database with correct fields', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await generateAiConsentTermImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.patientId).toBe(patientId);
    expect(row.userId).toBe(userId);
    expect(row.kind).toBe('ai_recording');
    expect(row.termText).toBeTruthy();
    expect(row.templateVersion).toBe(1);
    expect(row.templateSnapshot).toBeTruthy();
    expect(row.revocationTakesEffectImmediately).toBe(true);
    expect(row.signedAt).toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('returns ALREADY_ACTIVE when a pending (unsigned, non-revoked) term exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    const first = await generateAiConsentTermImpl(client, { patientId });
    expect(first.ok).toBe(true);

    const second = await generateAiConsentTermImpl(client, { patientId });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('ALREADY_ACTIVE');
  });

  it('returns ALREADY_ACTIVE when an active (signed, non-revoked) term exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Generate and simulate signing
    const first = await generateAiConsentTermImpl(client, { patientId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate signing directly in the DB
    await runAsService(async (db) => {
      await db
        .update(consentTerms)
        .set({ signedAt: dsql`now()` })
        .where(eq(consentTerms.patientId, patientId));
    });

    const second = await generateAiConsentTermImpl(client, { patientId });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('ALREADY_ACTIVE');
  });

  it('allows generating a new term after the previous one is revoked', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Generate and revoke
    const first = await generateAiConsentTermImpl(client, { patientId });
    expect(first.ok).toBe(true);

    await runAsService(async (db) => {
      await db
        .update(consentTerms)
        .set({ revokedAt: dsql`now()` })
        .where(eq(consentTerms.patientId, patientId));
    });

    // Generate a new one — should succeed
    const second = await generateAiConsentTermImpl(client, { patientId });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.publicUrl).toMatch(/^\/termo\/.+$/);
  });

  it('returns NOT_FOUND for a patient that does not exist', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await generateAiConsentTermImpl(client, { patientId: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');
  });

  // --- Negative auth test (cross-tenant) ---
  it("returns NOT_FOUND when psychologist B tries to generate for A's patient, and creates ZERO rows", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User B tries to generate consent for User A's patient
    const client = fakeSupabaseClient(userB);
    const result = await generateAiConsentTermImpl(client, { patientId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');

    // Verify ZERO rows were created in consent_terms
    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });
    expect(rows).toHaveLength(0);
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await generateAiConsentTermImpl(client, { patientId: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR for invalid patientId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await generateAiConsentTermImpl(client, { patientId: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('VALIDATION_ERROR');
  });

  it('sets expiresAt approximately 7 days in the future', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const before = Date.now();
    const client = fakeSupabaseClient(userId);
    const result = await generateAiConsentTermImpl(client, { patientId });
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    // expiresAt should be within a reasonable window of now + 7 days
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});
