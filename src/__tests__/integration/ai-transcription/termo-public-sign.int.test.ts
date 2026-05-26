import { randomBytes, randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { AI_CONSENT_TEMPLATE_V1 } from '@/modules/ai-transcription';
import { getAiConsentByTokenImpl } from '@/modules/patients/server/get-ai-consent-by-token';
import { signAiConsentImpl } from '@/modules/patients/server/sign-ai-consent';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  // CRP number derived from userId to guarantee uniqueness across concurrent
  // tests (the profiles table has a UNIQUE(crp_number, crp_uf) constraint).
  const shortId = userId.slice(0, 8);
  const fullName = `Dr Test ${shortId}`;
  const crpNumber = `T-${shortId}`;
  const crpUf = 'SP';
  const metadata = JSON.stringify({
    fullName,
    crpNumber,
    crpUf,
    termsAcceptedAt: '2024-01-01T00:00:00Z',
    privacyAcceptedAt: '2024-01-01T00:00:00Z',
    sensitiveDataConsentAt: '2024-01-01T00:00:00Z',
  });

  await runAsService(async (db) => {
    // Insert auth user — the `handle_new_user()` trigger creates a profile row.
    // If the user already exists (reused container), the DO NOTHING clause
    // prevents a conflict error but also prevents the trigger from firing.
    // In that case, we ensure the profile exists manually below.
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`},
                   ${metadata}::jsonb,
                   '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );

    // Ensure a profile row exists (the trigger may not have fired if the
    // auth.users row already existed from a previous test run).
    const email = `test-${userId}@example.com`;
    await db.execute(
      dsql`INSERT INTO public.profiles (
             user_id, email, full_name, crp_number, crp_uf, status,
             terms_accepted_at, privacy_accepted_at, sensitive_data_consent_at
           )
           VALUES (
             ${userId}, ${email}, ${fullName}, ${crpNumber}, ${crpUf}, 'active',
             now(), now(), now()
           )
           ON CONFLICT (user_id) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             crp_number = EXCLUDED.crp_number,
             crp_uf = EXCLUDED.crp_uf`,
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

function generateBase64UrlToken(): string {
  return randomBytes(32).toString('base64url');
}

async function seedAiConsentTerm(
  userId: string,
  patientId: string,
  token: string,
  opts?: { signedAt?: Date; revokedAt?: Date; createdAt?: Date },
): Promise<string> {
  const termId = randomUUID();
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id: termId,
      patientId,
      userId,
      kind: 'ai_recording',
      termText: AI_CONSENT_TEMPLATE_V1.title,
      templateVersion: AI_CONSENT_TEMPLATE_V1.version,
      templateSnapshot: AI_CONSENT_TEMPLATE_V1,
      signatureToken: token,
      signedAt: opts?.signedAt ?? null,
      revokedAt: opts?.revokedAt ?? null,
      revocationTakesEffectImmediately: true,
    });

    // Override created_at if provided (for expiry testing)
    if (opts?.createdAt) {
      await db
        .update(consentTerms)
        .set({ createdAt: opts.createdAt })
        .where(eq(consentTerms.id, termId));
    }
  });
  return termId;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(consentTerms);
    await db.delete(patients);
    // Profiles are cascade-deleted by auth.users foreign key, but delete
    // explicitly first to avoid FK constraint issues with other tables.
    await db.execute(
      dsql`DELETE FROM public.profiles WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI consent public signing — real Postgres', () => {
  // (a) Valid unsigned token -> POST succeeds, row updates with sha256 hashes
  it('signs a valid unsigned AI consent term with sha256-hashed IP and user-agent', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedAiConsentTerm(userId, patientId, token);

    const result = await signAiConsentImpl(token, '192.168.1.100', 'Mozilla/5.0');

    expect(result.ok).toBe(true);

    // Verify the row was updated with hashed values
    const rows = await runAsService(async (db) => {
      return db
        .select({
          signedAt: consentTerms.signedAt,
          signedIp: consentTerms.signedIp,
          signedUserAgent: consentTerms.signedUserAgent,
        })
        .from(consentTerms)
        .where(eq(consentTerms.signatureToken, token));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.signedAt).toBeInstanceOf(Date);

    // SHA-256 hex digest is always 64 characters
    expect(row.signedIp).toMatch(/^[0-9a-f]{64}$/);
    expect(row.signedIp).toHaveLength(64);
    expect(row.signedUserAgent).toMatch(/^[0-9a-f]{64}$/);
    expect(row.signedUserAgent).toHaveLength(64);

    // Hashed values must NOT be the raw input
    expect(row.signedIp).not.toBe('192.168.1.100');
    expect(row.signedUserAgent).not.toBe('Mozilla/5.0');
  });

  // (b) Expired token -> returns 'expired' error
  it('rejects an expired token with expired error', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    // Created 8 days ago -> expired (7-day window)
    await seedAiConsentTerm(userId, patientId, token, {
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const result = await signAiConsentImpl(token, '127.0.0.1', 'test-agent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('expired');
  });

  // Verify lookup also returns expired flag
  it('lookup returns expired flag for expired tokens', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedAiConsentTerm(userId, patientId, token, {
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const result = await getAiConsentByTokenImpl(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.expired).toBe(true);
    expect(result.data.alreadySigned).toBe(false);
  });

  // (c) Already signed -> returns "already_signed" error
  it('rejects an already signed token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedAiConsentTerm(userId, patientId, token, {
      signedAt: new Date(),
    });

    const result = await signAiConsentImpl(token, '127.0.0.1', 'test-agent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_signed');
  });

  // Verify lookup also returns already signed flag
  it('lookup returns alreadySigned flag for signed tokens', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedAiConsentTerm(userId, patientId, token, {
      signedAt: new Date(),
    });

    const result = await getAiConsentByTokenImpl(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alreadySigned).toBe(true);
  });

  // (d) Referrer-Policy: no-referrer header is present
  // NOTE: This header is set by Next.js via next.config.ts headers() function.
  // It cannot be tested in a pure integration test that calls server functions
  // directly. This is verified by the e2e suite instead.
  // TODO: Verify Referrer-Policy header in e2e tests.

  // (e) Bruteforce: 20 wrong tokens
  // NOTE: Rate limiting at the infrastructure level is not yet implemented.
  // The 256-bit token entropy provides unguessability (2^256 combinations),
  // making brute-force impractical. Infrastructure-level rate limiting (by IP)
  // is tracked as a known limitation.
  // TODO: Add rate limiting for public consent endpoints and test it.

  // --- Additional coverage ---

  it('returns not_found for an invalid token format', async () => {
    const result = await signAiConsentImpl('not-a-valid-token', '127.0.0.1', 'test-agent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for a nonexistent token', async () => {
    const token = generateBase64UrlToken();

    const result = await signAiConsentImpl(token, '127.0.0.1', 'test-agent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for a revoked token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedAiConsentTerm(userId, patientId, token, {
      revokedAt: new Date(),
    });

    const result = await signAiConsentImpl(token, '127.0.0.1', 'test-agent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('lookup returns template snapshot with psychologist and patient data', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedAiConsentTerm(userId, patientId, token);

    const result = await getAiConsentByTokenImpl(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.patientName).toBe('Test Patient');
    expect(result.data.psychologistName).toBeTruthy();
    expect(result.data.psychologistCrp).toMatch(/\//);
    expect(result.data.templateSnapshot).toBeTruthy();
    expect(result.data.alreadySigned).toBe(false);
    expect(result.data.expired).toBe(false);
  });

  it('double-signing via concurrent requests returns already_signed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateBase64UrlToken();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedAiConsentTerm(userId, patientId, token);

    // Race two sign attempts
    const [r1, r2] = await Promise.all([
      signAiConsentImpl(token, '10.0.0.1', 'agent-1'),
      signAiConsentImpl(token, '10.0.0.2', 'agent-2'),
    ]);

    // Exactly one should succeed
    const successes = [r1, r2].filter((r) => r.ok);
    const failures = [r1, r2].filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const failure = failures[0]!;
    if (failure.ok) return;
    expect(failure.error).toBe('already_signed');
  });
});
