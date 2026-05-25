import { randomBytes, randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadAttachmentImpl } from '@/modules/medical-records/server/attachments';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Minimal MP3 buffer (MPEG audio frame sync: 0xFF 0xFB)
// file-type detects MPEG audio by the sync frame header, NOT by the ID3 tag.
// ---------------------------------------------------------------------------

const MINIMAL_MP3_BUFFER = Buffer.from([
  0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

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
      status: 'active',
    });
  });
}

/**
 * Seeds an active (signed, not revoked) consent term for the patient.
 */
async function seedActiveConsent(userId: string, patientId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id: randomUUID(),
      patientId,
      userId,
      kind: 'general',
      termText: 'Consent term text for testing',
      signatureToken: token,
      revocationTakesEffectImmediately: false,
      signedAt: new Date(),
    });
  });
}

/**
 * Seeds a revoked consent term (signed then revoked) for the patient.
 */
async function seedRevokedConsent(userId: string, patientId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id: randomUUID(),
      patientId,
      userId,
      kind: 'general',
      termText: 'Revoked consent term text for testing',
      signatureToken: token,
      revocationTakesEffectImmediately: false,
      signedAt: new Date(Date.now() - 86_400_000), // signed yesterday
      revokedAt: new Date(), // revoked now
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://storage.example.com/signed?token=abc' },
          error: null,
        }),
      }),
    },
  } as unknown as Parameters<typeof uploadAttachmentImpl>[0];
}

function createAudioFormData(): FormData {
  const file = new File([MINIMAL_MP3_BUFFER], 'recording.mp3', { type: 'audio/mpeg' });
  const fd = new FormData();
  fd.set('file', file);
  fd.set('category', 'audio');
  return fd;
}

afterEach(async () => {
  // Clean consent_terms explicitly since cleanTestData deletes patients (which CASCADE to consent_terms)
  await cleanTestData();
});

// =====================================================================
// Audio upload consent gate (CFP 13/2022 — RN-05.07)
// =====================================================================

describe('audio upload consent gate', () => {
  it('blocks audio upload when patient has no consent term', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    // No consent seeded

    const fd = createAudioFormData();
    const result = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONSENT_REQUIRED');
  });

  it('allows audio upload when patient has active signed consent', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);

    const fd = createAudioFormData();
    const result = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBeDefined();
  });

  it('blocks audio upload when consent has been revoked', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRevokedConsent(userId, patientId);

    const fd = createAudioFormData();
    const result = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONSENT_REQUIRED');
  });

  it('blocks audio upload when consent exists for different psychologist', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientIdA = randomUUID();
    const patientIdB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientIdA);
    await seedPatient(userB, patientIdB);

    // Consent belongs to userA's patient
    await seedActiveConsent(userA, patientIdA);

    // userB tries to upload audio for their own patient without consent
    const fd = createAudioFormData();
    const result = await uploadAttachmentImpl(fakeSupabaseClient(userB), patientIdB, fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONSENT_REQUIRED');
  });

  it('unsigned consent (generated but not signed) blocks audio upload', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed consent WITHOUT signedAt (just generated, not yet signed)
    const token = randomBytes(32).toString('hex');
    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: randomUUID(),
        patientId,
        userId,
        kind: 'general',
        termText: 'Unsigned consent term',
        signatureToken: token,
        revocationTakesEffectImmediately: false,
        // signedAt is null by default — consent not yet signed
      });
    });

    const fd = createAudioFormData();
    const result = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONSENT_REQUIRED');
  });
});
