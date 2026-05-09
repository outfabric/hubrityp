import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateConsentImpl } from '@/modules/patients/server/generate-consent';
import { getConsentByTokenImpl } from '@/modules/patients/server/get-consent-by-token';
import type { SignConsentResult } from '@/modules/patients/server/sign-consent';
import { profiles } from '@/shared/db/schema/auth/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the Supabase JS client used by sign-consent for storage uploads.
// The test container has no Supabase Storage service, so we stub the upload.
const storageUploadMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: storageUploadMock,
      }),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed an auth.users row. Uses provider="google" in raw_app_meta_data so the
 * handle_new_user trigger skips auto-profile creation (we seed the profile
 * separately with controlled values via seedProfile).
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

async function seedProfile(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(profiles).values({
      userId,
      email: `test-${userId}@example.com`,
      fullName: 'Dra. Maria Silva',
      crpNumber: '06/12345',
      crpUf: 'SP',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'João da Silva',
    });
  });
}

/**
 * Build a minimal fake Supabase client for authenticated server actions
 * (generateConsentImpl). The signing flow does not use this — it is
 * unauthenticated and uses the token directly.
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake impl
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof generateConsentImpl>[0];
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageUploadMock.mockReset();
  // Default: storage upload succeeds
  storageUploadMock.mockResolvedValue({ data: { path: 'mock-path.pdf' }, error: null });
});

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(consentTerms);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM profiles WHERE email LIKE 'test-%@example.com'`);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// getConsentByTokenImpl
// ---------------------------------------------------------------------------

describe('getConsentByTokenImpl', () => {
  it('returns consent data for a valid token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    const result = await getConsentByTokenImpl(genResult.token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.consentId).toBe(genResult.consentId);
    expect(result.data.termText).toBeTruthy();
    expect(result.data.patientName).toBe('João da Silva');
    expect(result.data.psychologistName).toBe('Dra. Maria Silva');
    expect(result.data.psychologistCrp).toBe('06/12345/SP');
    expect(result.data.alreadySigned).toBe(false);
  });

  it('returns not_found for a non-existent token', async () => {
    // Valid hex format but does not exist in DB
    const fakeToken = 'a'.repeat(64);
    const result = await getConsentByTokenImpl(fakeToken);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for an invalid token format', async () => {
    const result = await getConsentByTokenImpl('not-a-valid-token');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for a revoked consent token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    // Revoke the consent term directly
    await runAsService(async (db) => {
      await db
        .update(consentTerms)
        .set({ revokedAt: dsql`now()` })
        .where(eq(consentTerms.id, genResult.consentId));
    });

    const result = await getConsentByTokenImpl(genResult.token);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('reports alreadySigned=true when consent was previously signed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    // Simulate signing directly in DB
    await runAsService(async (db) => {
      await db
        .update(consentTerms)
        .set({
          signedAt: dsql`now()`,
          signedIp: '127.0.0.1',
          signedUserAgent: 'test-agent',
        })
        .where(eq(consentTerms.id, genResult.consentId));
    });

    const result = await getConsentByTokenImpl(genResult.token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alreadySigned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// signConsentImpl
// ---------------------------------------------------------------------------

describe('signConsentImpl', () => {
  // Import dynamically so the vi.mock above takes effect before module load
  let signConsentImpl: (token: string, ip: string, userAgent: string) => Promise<SignConsentResult>;

  beforeEach(async () => {
    const mod = await import('@/modules/patients/server/sign-consent');
    signConsentImpl = mod.signConsentImpl;
  });

  it('signs a consent term successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    const result = await signConsentImpl(genResult.token, '192.168.1.1', 'Mozilla/5.0 Test');

    expect(result.ok).toBe(true);

    // Verify consent_terms row was updated
    const termRows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, genResult.consentId));
    });

    const term = termRows[0]!;
    expect(term.signedAt).toBeInstanceOf(Date);
    expect(term.signedIp).toBe('192.168.1.1');
    expect(term.signedUserAgent).toBe('Mozilla/5.0 Test');
  });

  it('saves signed_pdf_path after successful upload', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    await signConsentImpl(genResult.token, '10.0.0.1', 'TestAgent');

    const termRows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, genResult.consentId));
    });

    const expectedPath = `${userId}/${patientId}/${genResult.consentId}.pdf`;
    expect(termRows[0]!.signedPdfPath).toBe(expectedPath);
  });

  it('updates patient.consent_signed_at on signing', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    // Before signing: consent_signed_at should be null
    const beforeRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(beforeRows[0]!.consentSignedAt).toBeNull();

    await signConsentImpl(genResult.token, '10.0.0.1', 'TestAgent');

    // After signing: consent_signed_at should be set
    const afterRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(afterRows[0]!.consentSignedAt).toBeInstanceOf(Date);
  });

  it('returns not_found for an invalid token', async () => {
    const result = await signConsentImpl('invalid-token', '10.0.0.1', 'TestAgent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for a non-existent token', async () => {
    const fakeToken = 'b'.repeat(64);
    const result = await signConsentImpl(fakeToken, '10.0.0.1', 'TestAgent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns already_signed when consent was already signed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    // Sign once
    const first = await signConsentImpl(genResult.token, '10.0.0.1', 'Agent1');
    expect(first.ok).toBe(true);

    // Try to sign again
    const second = await signConsentImpl(genResult.token, '10.0.0.2', 'Agent2');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('already_signed');
  });

  it('returns not_found for a revoked consent token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    // Revoke the consent term directly
    await runAsService(async (db) => {
      await db
        .update(consentTerms)
        .set({ revokedAt: dsql`now()` })
        .where(eq(consentTerms.id, genResult.consentId));
    });

    const result = await signConsentImpl(genResult.token, '10.0.0.1', 'TestAgent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('calls storage upload with the correct bucket path', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    await signConsentImpl(genResult.token, '10.0.0.1', 'TestAgent');

    expect(storageUploadMock).toHaveBeenCalledOnce();
    const [path, buffer, options] = storageUploadMock.mock.calls[0]!;
    expect(path).toBe(`${userId}/${patientId}/${genResult.consentId}.pdf`);
    expect(buffer).toBeInstanceOf(Buffer);
    expect((buffer as Buffer).length).toBeGreaterThan(0);
    expect(options).toEqual({
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it('still succeeds when storage upload fails (graceful degradation)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    storageUploadMock.mockResolvedValue({
      data: null,
      error: { message: 'Bucket not found', statusCode: '404' },
    });

    const client = fakeSupabaseClient(userId);
    const genResult = await generateConsentImpl(client, patientId);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    const result = await signConsentImpl(genResult.token, '10.0.0.1', 'TestAgent');

    // Signing should still succeed
    expect(result.ok).toBe(true);

    // But signed_pdf_path should be null (upload failed)
    const termRows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, genResult.consentId));
    });
    expect(termRows[0]!.signedPdfPath).toBeNull();

    // The signing metadata should still be recorded
    expect(termRows[0]!.signedAt).toBeInstanceOf(Date);
    expect(termRows[0]!.signedIp).toBe('10.0.0.1');
  });
});
