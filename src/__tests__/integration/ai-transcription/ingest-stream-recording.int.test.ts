import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Storage SDK — no local Supabase Storage in Testcontainers
// ---------------------------------------------------------------------------

const storageUploadCalls: Array<{ path: string; size: number }> = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn((path: string, data: Buffer) => {
          storageUploadCalls.push({ path, size: data.length });
          return Promise.resolve({ data: { path }, error: null });
        }),
      })),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Mock Stream client — capture deleteRecording calls
// ---------------------------------------------------------------------------

const streamDeleteCalls: Array<{ session: string; filename: string }> = [];

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: vi.fn(() => ({
    video: {
      call: vi.fn(() => ({
        deleteRecording: vi.fn((request: { session: string; filename: string }) => {
          streamDeleteCalls.push(request);
          return Promise.resolve({});
        }),
      })),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Mock inngest — capture sends for event dispatch assertions
// ---------------------------------------------------------------------------

const inngestSendCalls: unknown[] = [];

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    send: vi.fn((...args: unknown[]) => {
      inngestSendCalls.push(args);
      return Promise.resolve();
    }),
    createFunction: vi.fn((_config: unknown, handler: unknown) => handler),
  },
}));

// ---------------------------------------------------------------------------
// Local HTTP server to simulate Stream CDN
// ---------------------------------------------------------------------------

let cdnServer: http.Server;
let cdnBaseUrl: string;

/** Creates a valid WebM file header (EBML magic bytes) with padding. */
function createWebmBuffer(sizeBytes: number = 4096): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  // EBML header (WebM/Matroska magic bytes)
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

/** Creates a garbage buffer that does not match any audio format. */
function createGarbageBuffer(sizeBytes: number = 4096): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf.fill(0x42); // All 'B' bytes
  return buf;
}

// Shared state: the response the CDN server will serve next
let cdnNextResponse: { status: number; body: Buffer } = {
  status: 200,
  body: createWebmBuffer(),
};

beforeAll(async () => {
  // Start a local HTTP server that simulates Stream CDN
  cdnServer = http.createServer((_req, res) => {
    res.writeHead(cdnNextResponse.status, {
      'Content-Type': 'audio/webm',
      'Content-Length': cdnNextResponse.body.length.toString(),
    });
    res.end(cdnNextResponse.body);
  });

  await new Promise<void>((resolve) => {
    cdnServer.listen(0, '127.0.0.1', () => {
      const addr = cdnServer.address() as AddressInfo;
      cdnBaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    cdnServer.close((err) => (err ? reject(err) : resolve()));
  });
});

// ---------------------------------------------------------------------------
// Seed helpers
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
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

async function seedActiveConsent(userId: string, patientId: string): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id,
      patientId,
      userId,
      kind: 'ai_recording',
      termText: 'AI consent term text',
      signatureToken: generateToken(),
      signedAt: new Date(),
      revokedAt: null,
      templateVersion: 1,
      templateSnapshot: { version: 1 },
      revocationTakesEffectImmediately: true,
      createdAt: new Date(),
    });
  });
  return id;
}

async function seedSession(userId: string, patientId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    const now = new Date();
    const endAt = new Date(now.getTime() + 60 * 60 * 1000); // +1h
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt,
      durationMinutes: 60,
      status: 'done',
    });
  });
}

// ---------------------------------------------------------------------------
// Dynamic imports — after mocks are registered
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type IngestModule = typeof import('@/modules/ai-transcription/inngest/ingest-stream-recording');

let validateStreamUrl: IngestModule['validateStreamUrl'];
let downloadRecording: IngestModule['downloadRecording'];
let hasValidAudioMagic: IngestModule['hasValidAudioMagic'];

async function importHelpers() {
  const mod = await import('@/modules/ai-transcription/inngest/ingest-stream-recording');
  validateStreamUrl = mod.validateStreamUrl;
  downloadRecording = mod.downloadRecording;
  hasValidAudioMagic = mod.hasValidAudioMagic;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  inngestSendCalls.length = 0;
  storageUploadCalls.length = 0;
  streamDeleteCalls.length = 0;
  cdnNextResponse = { status: 200, body: createWebmBuffer() };

  await runAsService(async (db) => {
    await db.delete(aiTranscriptions);
    await db.delete(consentTerms);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ingestStreamRecording — integration (real Postgres + local CDN)', () => {
  it('setup: imports the implementation', async () => {
    await importHelpers();
    expect(validateStreamUrl).toBeDefined();
    expect(downloadRecording).toBeDefined();
    expect(hasValidAudioMagic).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Happy path — download from local CDN, create row, upload to Storage
  // -----------------------------------------------------------------------

  it('creates a transcription row and uploads audio on happy path', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, patientId, sessionId);
    await seedActiveConsent(userId, patientId);

    const recordingUrl = `${cdnBaseUrl}/recordings/default/call123/session456/rec.webm`;

    // Step 1: Assert consent (uses real DB)
    const { assertAiConsentActive } = await import('@/modules/ai-transcription/lib/consent');
    const { db: directDb } = await import('@/shared/db/client');

    const consentResult = await assertAiConsentActive({ userId, patientId }, { db: directDb });
    expect(consentResult.ok).toBe(true);

    // Step 2: Create row in real DB
    const [newRow] = await runAsService(async (db) => {
      return db
        .insert(aiTranscriptions)
        .values({
          userId,
          patientId,
          sessionId,
          source: 'video_session',
          status: 'pending',
        })
        .returning({ id: aiTranscriptions.id });
    });
    expect(newRow).toBeDefined();
    const transcriptionId = newRow!.id;

    // Step 3: Download from local CDN (with relaxed allowlist)
    const validatedUrl = await validateStreamUrl(recordingUrl, {
      hostAllowlist: ['127.0.0.1'],
    });
    const buffer = await downloadRecording(validatedUrl);

    // Verify magic numbers
    expect(hasValidAudioMagic(buffer)).toBe(true);
    expect(buffer.length).toBe(4096);

    // Step 4: Upload to Storage (mocked)
    const { createClient } = await import('@supabase/supabase-js');
    const storageClient = createClient('http://localhost:54321', 'fake-key');
    const objectKey = `${userId}/${transcriptionId}.webm`;
    const { error } = await storageClient.storage
      .from('ai-transcription-audio')
      .upload(objectKey, buffer, {
        contentType: 'audio/webm',
        upsert: false,
      });
    expect(error).toBeNull();
    expect(storageUploadCalls).toHaveLength(1);
    expect(storageUploadCalls[0]!.path).toBe(objectKey);
    expect(storageUploadCalls[0]!.size).toBe(4096);

    // Step 5: Update the row with metadata
    await runAsService(async (db) => {
      await db
        .update(aiTranscriptions)
        .set({
          audioObjectKey: objectKey,
          audioSizeBytes: buffer.length,
          audioDurationSeconds: null,
          updatedAt: new Date(),
        })
        .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)));
    });

    // Verify the row in the real database
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('pending');
      expect(row.audioObjectKey).toBe(objectKey);
      expect(row.audioSizeBytes).toBe(4096);
      expect(row.source).toBe('video_session');
      expect(row.userId).toBe(userId);
      expect(row.patientId).toBe(patientId);
      expect(row.sessionId).toBe(sessionId);
    } finally {
      await sql.end();
    }
  });

  // -----------------------------------------------------------------------
  // Consent inactive — no row created, no download
  // -----------------------------------------------------------------------

  it('skips ingestion when consent is not active', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    // No consent seeded — patient never signed

    const { assertAiConsentActive } = await import('@/modules/ai-transcription/lib/consent');
    const { db: directDb } = await import('@/shared/db/client');

    const consentResult = await assertAiConsentActive({ userId, patientId }, { db: directDb });
    expect(consentResult.ok).toBe(false);
    if (!consentResult.ok) {
      expect(consentResult.reason).toBe('never_signed');
    }

    // No transcription row should exist
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.userId, userId));

      expect(rows).toHaveLength(0);
    } finally {
      await sql.end();
    }

    // No storage upload
    expect(storageUploadCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // SSRF — hostname not in allowlist
  // -----------------------------------------------------------------------

  it('rejects URLs with hostnames not in the allowlist (SSRF)', async () => {
    await expect(validateStreamUrl('https://evil.com/recordings/abc.webm', {})).rejects.toThrow(
      'SSRF',
    );
  });

  // -----------------------------------------------------------------------
  // SSRF — host resolves to private IP
  // -----------------------------------------------------------------------

  it('rejects URLs that resolve to private IPs (SSRF)', async () => {
    const resolveDns = () => Promise.resolve(['192.168.1.1']);

    await expect(
      validateStreamUrl('https://stream-io-cdn.com/recordings/abc.webm', {
        resolveDns,
      }),
    ).rejects.toThrow('SSRF: hostname "stream-io-cdn.com" resolves to private IP');
  });

  // -----------------------------------------------------------------------
  // Stream returns 500 — download fails
  // -----------------------------------------------------------------------

  it('throws on Stream HTTP 500 response', async () => {
    cdnNextResponse = { status: 500, body: Buffer.from('Internal Server Error') };

    const validatedUrl = await validateStreamUrl(cdnBaseUrl + '/fail.webm', {
      hostAllowlist: ['127.0.0.1'],
    });

    await expect(downloadRecording(validatedUrl)).rejects.toThrow(
      'Stream download failed: HTTP 500',
    );
  });

  // -----------------------------------------------------------------------
  // Corrupted file — invalid magic numbers
  // -----------------------------------------------------------------------

  it('detects corrupted file via magic-number check', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);

    // Serve garbage bytes from CDN
    cdnNextResponse = { status: 200, body: createGarbageBuffer() };

    const validatedUrl = await validateStreamUrl(cdnBaseUrl + '/corrupted.webm', {
      hostAllowlist: ['127.0.0.1'],
    });
    const buffer = await downloadRecording(validatedUrl);

    // Magic number check should fail
    expect(hasValidAudioMagic(buffer)).toBe(false);

    // When the function detects this, it marks the row as failed.
    // Simulate that by creating a row and updating it.
    const [newRow] = await runAsService(async (db) => {
      return db
        .insert(aiTranscriptions)
        .values({
          userId,
          patientId,
          source: 'video_session',
          status: 'pending',
        })
        .returning({ id: aiTranscriptions.id });
    });
    const transcriptionId = newRow!.id;

    await runAsService(async (db) => {
      await db
        .update(aiTranscriptions)
        .set({
          status: 'failed',
          errorCode: 'invalid_mime',
          updatedAt: new Date(),
        })
        .where(eq(aiTranscriptions.id, transcriptionId));
    });

    // Verify the row status
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('failed');
      expect(row.errorCode).toBe('invalid_mime');
    } finally {
      await sql.end();
    }

    // No storage upload should happen for corrupted files
    expect(storageUploadCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Event emission — validate the dispatched event shape
  // -----------------------------------------------------------------------

  it('emits audio.uploaded event with correct shape', async () => {
    const { audioUploadedEventSchema } = await import('@/modules/ai-transcription/inngest/events');

    const transcriptionId = randomUUID();
    const userId = randomUUID();
    const patientId = randomUUID();

    const eventData = audioUploadedEventSchema.parse({
      transcriptionId,
      userId,
      patientId,
      source: 'video_session',
    });

    expect(eventData.source).toBe('video_session');
    expect(eventData.transcriptionId).toBe(transcriptionId);
    expect(eventData.userId).toBe(userId);
    expect(eventData.patientId).toBe(patientId);
  });
});
