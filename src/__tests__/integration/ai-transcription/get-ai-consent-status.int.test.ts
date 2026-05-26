import { randomBytes, randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getAiConsentStatusImpl } from '@/modules/patients/server/get-ai-consent-status';
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

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

interface SeedConsentOpts {
  userId: string;
  patientId: string;
  signedAt?: Date | null;
  revokedAt?: Date | null;
  revocationReason?: string | null;
  createdAt?: Date;
  templateVersion?: number;
}

async function seedConsentTerm(opts: SeedConsentOpts): Promise<string> {
  const id = randomUUID();
  const token = generateToken();
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id,
      patientId: opts.patientId,
      userId: opts.userId,
      kind: 'ai_recording',
      termText: 'AI consent term text',
      signatureToken: token,
      signedAt: opts.signedAt ?? null,
      revokedAt: opts.revokedAt ?? null,
      revocationReason: opts.revocationReason ?? null,
      templateVersion: opts.templateVersion ?? 1,
      templateSnapshot: { version: opts.templateVersion ?? 1 },
      revocationTakesEffectImmediately: true,
      createdAt: opts.createdAt ?? new Date(),
    });
  });
  return id;
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
  } as Parameters<typeof getAiConsentStatusImpl>[0];
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
// Tests: all four states
// ---------------------------------------------------------------------------

describe('getAiConsentStatusImpl — real Postgres', () => {
  it('returns state "none" when no ai_recording consent term exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent).toEqual({ state: 'none' });
  });

  it('returns state "pending" with publicUrl and expiresAt for unsigned non-expired term', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedConsentTerm({
      userId,
      patientId,
      signedAt: null,
      createdAt: new Date(), // Just created, not expired
    });

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.state).toBe('pending');
    if (result.consent.state !== 'pending') return;
    expect(result.consent.publicUrl).toMatch(/^\/termo\/.+$/);
    expect(result.consent.expiresAt).toBeInstanceOf(Date);
    expect(result.consent.createdAt).toBeInstanceOf(Date);
  });

  it('returns state "none" for an unsigned expired term (created > 7 days ago)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await seedConsentTerm({
      userId,
      patientId,
      signedAt: null,
      createdAt: eightDaysAgo,
    });

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Expired unsigned terms are treated as 'none'
    expect(result.consent).toEqual({ state: 'none' });
  });

  it('returns state "active" with signedAt and templateVersion for signed non-revoked term', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const signedAt = new Date('2026-05-15T10:00:00Z');
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedConsentTerm({
      userId,
      patientId,
      signedAt,
      templateVersion: 1,
    });

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.state).toBe('active');
    if (result.consent.state !== 'active') return;
    expect(result.consent.signedAt).toEqual(signedAt);
    expect(result.consent.templateVersion).toBe(1);
  });

  it('returns state "revoked" with revokedAt and reason for revoked term', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const revokedAt = new Date('2026-05-20T14:00:00Z');
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-15T10:00:00Z'),
      revokedAt,
      revocationReason: 'No longer needed',
    });

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.state).toBe('revoked');
    if (result.consent.state !== 'revoked') return;
    expect(result.consent.revokedAt).toEqual(revokedAt);
    expect(result.consent.reason).toBe('No longer needed');
  });

  it('returns state "revoked" with null reason when reason is absent', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-15T10:00:00Z'),
      revokedAt: new Date('2026-05-20T14:00:00Z'),
      revocationReason: null,
    });

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.state).toBe('revoked');
    if (result.consent.state !== 'revoked') return;
    expect(result.consent.reason).toBeNull();
  });

  // --- Seed all four states for different patients, verify each ---
  it('returns the correct state for each of four patients seeded with different states', async () => {
    const userId = randomUUID();
    const nonePatient = randomUUID();
    const pendingPatient = randomUUID();
    const activePatient = randomUUID();
    const revokedPatient = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, nonePatient);
    await seedPatient(userId, pendingPatient);
    await seedPatient(userId, activePatient);
    await seedPatient(userId, revokedPatient);

    // pending: unsigned, non-expired
    await seedConsentTerm({
      userId,
      patientId: pendingPatient,
      signedAt: null,
      createdAt: new Date(),
    });

    // active: signed, non-revoked
    await seedConsentTerm({
      userId,
      patientId: activePatient,
      signedAt: new Date('2026-05-15T10:00:00Z'),
      templateVersion: 1,
    });

    // revoked: signed and then revoked
    await seedConsentTerm({
      userId,
      patientId: revokedPatient,
      signedAt: new Date('2026-05-10T10:00:00Z'),
      revokedAt: new Date('2026-05-18T14:00:00Z'),
      revocationReason: 'Patient withdrew',
    });

    const client = fakeSupabaseClient(userId);

    // None
    const noneResult = await getAiConsentStatusImpl(client, { patientId: nonePatient });
    expect(noneResult.ok).toBe(true);
    if (!noneResult.ok) return;
    expect(noneResult.consent.state).toBe('none');

    // Pending
    const pendingResult = await getAiConsentStatusImpl(client, { patientId: pendingPatient });
    expect(pendingResult.ok).toBe(true);
    if (!pendingResult.ok) return;
    expect(pendingResult.consent.state).toBe('pending');

    // Active
    const activeResult = await getAiConsentStatusImpl(client, { patientId: activePatient });
    expect(activeResult.ok).toBe(true);
    if (!activeResult.ok) return;
    expect(activeResult.consent.state).toBe('active');

    // Revoked
    const revokedResult = await getAiConsentStatusImpl(client, { patientId: revokedPatient });
    expect(revokedResult.ok).toBe(true);
    if (!revokedResult.ok) return;
    expect(revokedResult.consent.state).toBe('revoked');
  });

  // --- Cross-tenant assertions ---
  it('returns state "none" when psychologist B queries A\'s patient (cross-tenant isolation)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User A has an active consent term
    await seedConsentTerm({
      userId: userA,
      patientId,
      signedAt: new Date('2026-05-15T10:00:00Z'),
    });

    // User B queries — should get 'none' (does not leak patient existence)
    const clientB = fakeSupabaseClient(userB);
    const result = await getAiConsentStatusImpl(clientB, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent).toEqual({ state: 'none' });
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getAiConsentStatusImpl(client, { patientId: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR for invalid patientId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('VALIDATION_ERROR');
  });

  it('considers the most recent term when multiple exist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Older row: active (signed, not revoked)
    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-01T10:00:00Z'),
      createdAt: new Date('2026-04-30T10:00:00Z'),
    });

    // Newer row: revoked — this should be the one returned
    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-10T10:00:00Z'),
      revokedAt: new Date('2026-05-15T14:00:00Z'),
      revocationReason: 'Changed mind',
      createdAt: new Date('2026-05-09T10:00:00Z'),
    });

    const client = fakeSupabaseClient(userId);
    const result = await getAiConsentStatusImpl(client, { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.state).toBe('revoked');
  });
});
