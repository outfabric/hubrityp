import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_TRANSCRIPTION_EVENTS } from '@/modules/ai-transcription/inngest/events';
import { assertAiConsentActive } from '@/modules/ai-transcription/lib/consent';
import { revokeAiConsentTermImpl } from '@/modules/patients/server/revoke-ai-consent';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Inngest client — intercept `inngest.send()` at the module level so
// the real DB path runs but no outbound HTTP call leaves the test.
// vi.hoisted() ensures the reference is available when vi.mock() factories
// execute (they are hoisted above imports by Vitest).
// ---------------------------------------------------------------------------

const { mockInngestSend } = vi.hoisted(() => ({
  mockInngestSend: vi.fn(),
}));

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

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
  id?: string;
  userId: string;
  patientId: string;
  signedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt?: Date;
}

/**
 * Seeds a signed, non-revoked ai_recording consent term (active state).
 * Returns the consent term ID.
 */
async function seedActiveConsentTerm(opts: SeedConsentOpts): Promise<string> {
  const id = opts.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id,
      patientId: opts.patientId,
      userId: opts.userId,
      kind: 'ai_recording',
      termText: 'AI consent term text',
      signatureToken: generateToken(),
      signedAt: opts.signedAt ?? new Date(),
      revokedAt: opts.revokedAt ?? null,
      templateVersion: 1,
      templateSnapshot: { version: 1 },
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
  } as Parameters<typeof revokeAiConsentTermImpl>[0];
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockInngestSend.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await runAsService(async (db) => {
    await db.delete(consentTerms);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('revokeAiConsentTermImpl — real Postgres', () => {
  it('revokes an active ai_recording consent term', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const termId = await seedActiveConsentTerm({ userId, patientId });

    const client = fakeSupabaseClient(userId);
    const result = await revokeAiConsentTermImpl(client, {
      patientId,
      reason: 'Patient requested',
    });

    expect(result.ok).toBe(true);

    // Verify the term is revoked in the DB
    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, termId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(rows[0]!.revocationReason).toBe('Patient requested');
  });

  it('revokes with a null reason', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedActiveConsentTerm({ userId, patientId });

    const client = fakeSupabaseClient(userId);
    const result = await revokeAiConsentTermImpl(client, {
      patientId,
      reason: null,
    });

    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });
    expect(rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(rows[0]!.revocationReason).toBeNull();
  });

  it('dispatches the consent.revoked Inngest event with correct payload', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const termId = await seedActiveConsentTerm({ userId, patientId });

    const client = fakeSupabaseClient(userId);
    await revokeAiConsentTermImpl(client, {
      patientId,
      reason: 'No longer needed',
    });

    expect(mockInngestSend).toHaveBeenCalledOnce();
    const call = mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(call.name).toBe(AI_TRANSCRIPTION_EVENTS.CONSENT_REVOKED);
    expect(call.data.termId).toBe(termId);
    expect(call.data.userId).toBe(userId);
    expect(call.data.patientId).toBe(patientId);
    expect(call.data.reason).toBe('No longer needed');
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });

  it('still succeeds (ok: true) when inngest.send fails', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedActiveConsentTerm({ userId, patientId });

    // Make inngest.send throw
    mockInngestSend.mockRejectedValueOnce(new Error('Inngest is down'));

    const client = fakeSupabaseClient(userId);
    const result = await revokeAiConsentTermImpl(client, {
      patientId,
      reason: null,
    });

    // DB update still committed, action returns ok
    expect(result.ok).toBe(true);

    // Verify the term is actually revoked in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });
    expect(rows[0]!.revokedAt).toBeInstanceOf(Date);
  });

  it('assertAiConsentActive returns revoked after revocation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedActiveConsentTerm({ userId, patientId });

    // Before revocation, the consent is active
    const { sql: sql1, db: db1 } = openClient();
    try {
      const beforeResult = await assertAiConsentActive({ userId, patientId }, { db: db1 });
      expect(beforeResult.ok).toBe(true);
    } finally {
      await sql1.end();
    }

    // Revoke
    const client = fakeSupabaseClient(userId);
    const result = await revokeAiConsentTermImpl(client, {
      patientId,
      reason: 'Withdrew consent',
    });
    expect(result.ok).toBe(true);

    // After revocation, assertAiConsentActive should return revoked
    const { sql: sql2, db: db2 } = openClient();
    try {
      const afterResult = await assertAiConsentActive({ userId, patientId }, { db: db2 });
      expect(afterResult).toEqual({ ok: false, reason: 'revoked' });
    } finally {
      await sql2.end();
    }
  });

  it('returns NOT_FOUND when no signed consent exists (only pending)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed a pending (unsigned) consent term
    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        patientId,
        userId,
        kind: 'ai_recording',
        termText: 'AI consent term text',
        signatureToken: generateToken(),
        signedAt: null,
        revokedAt: null,
        templateVersion: 1,
        templateSnapshot: { version: 1 },
        revocationTakesEffectImmediately: true,
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await revokeAiConsentTermImpl(client, {
      patientId,
      reason: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when consent is already revoked', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed an already-revoked consent term
    await seedActiveConsentTerm({
      userId,
      patientId,
      revokedAt: new Date(),
    });

    const client = fakeSupabaseClient(userId);
    const result = await revokeAiConsentTermImpl(client, {
      patientId,
      reason: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');
  });

  // --- Cross-tenant negative auth test ---
  it("returns NOT_FOUND when psychologist B tries to revoke A's patient's term", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User A has an active consent term
    await seedActiveConsentTerm({ userId: userA, patientId });

    // User B tries to revoke
    const clientB = fakeSupabaseClient(userB);
    const result = await revokeAiConsentTermImpl(clientB, {
      patientId,
      reason: 'Attacker reason',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('NOT_FOUND');

    // Verify the term is NOT revoked — still active in DB
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(consentTerms)
        .where(and(eq(consentTerms.patientId, patientId), isNull(consentTerms.revokedAt)));
    });
    expect(rows).toHaveLength(1);
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await revokeAiConsentTermImpl(client, {
      patientId: randomUUID(),
      reason: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR for invalid patientId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await revokeAiConsentTermImpl(client, {
      patientId: 'not-a-uuid',
      reason: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('VALIDATION_ERROR');
  });
});
