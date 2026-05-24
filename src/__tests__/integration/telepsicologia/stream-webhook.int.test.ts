import crypto, { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  videoRecordings,
  videoRooms,
  videoSessionLogs,
} from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Well-known webhook secret set by the integration global-setup
 * (`src/__tests__/integration/setup/global-setup.ts`). The Route Handler
 * reads the same value via `serverEnv.STREAM_WEBHOOK_SECRET` after Zod
 * validation picks up `process.env.STREAM_WEBHOOK_SECRET` injected by
 * the global-setup.
 */
const INTEGRATION_WEBHOOK_SECRET = 'integration-stream-webhook-secret';

/**
 * Compute the HMAC-SHA256 hex signature for a given body, matching the
 * algorithm used by Stream's webhook delivery (and our handler's
 * `verifyStreamSignature`).
 */
function signPayload(body: string, secret: string = INTEGRATION_WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(body).digest('hex');
}

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
      patientType: 'individual',
    });
  });
}

async function seedSession(userId: string, sessionId: string, patientId: string): Promise<void> {
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000);
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: later,
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });
  });
}

async function seedVideoRoom(
  userId: string,
  sessionId: string,
  opts?: { status?: string; streamCallId?: string },
): Promise<string> {
  const roomId = randomUUID();
  const now = new Date();
  const streamCallId = opts?.streamCallId ?? `session-${sessionId}`;
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: roomId,
      userId,
      sessionId,
      streamCallId,
      patientToken: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      patientJwt: 'mock-patient-jwt',
      availableFrom: new Date(now.getTime() - 600_000),
      expiresAt: new Date(now.getTime() + 7200_000),
      status: opts?.status ?? 'active',
    });
  });
  return streamCallId;
}

async function seedVideoRecording(
  userId: string,
  sessionId: string,
  opts?: { status?: string },
): Promise<string> {
  const recordingId = randomUUID();
  await runAsService(async (db) => {
    await db.insert(videoRecordings).values({
      id: recordingId,
      sessionId,
      userId,
      status: opts?.status ?? 'idle',
    });
  });
  return recordingId;
}

/**
 * Construct a NextRequest that simulates a Stream webhook POST.
 * Computes the correct HMAC signature unless `overrideSignature` is provided.
 */
function makeWebhookRequest(payload: unknown, overrideSignature?: string): NextRequest {
  const body = JSON.stringify(payload);
  const signature = overrideSignature ?? signPayload(body);
  return new NextRequest('http://localhost/api/webhooks/stream/video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': signature,
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/stream/video', () => {
  // =========================================================================
  // Signature validation
  // =========================================================================

  it('returns 403 for invalid signature', async () => {
    const { POST } = await import('@/app/api/webhooks/stream/video/route');

    const request = makeWebhookRequest(
      { type: 'call.session_ended', call_cid: 'default:test-call' },
      'invalid-signature-value',
    );

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 for malformed JSON payload', async () => {
    const { POST } = await import('@/app/api/webhooks/stream/video/route');

    const rawBody = 'not-valid-json{{{';
    const signature = signPayload(rawBody);
    const request = new NextRequest('http://localhost/api/webhooks/stream/video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': signature,
      },
      body: rawBody,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for valid JSON that fails Zod validation (missing type)', async () => {
    const { POST } = await import('@/app/api/webhooks/stream/video/route');

    const request = makeWebhookRequest({ call_cid: 'default:test-call' });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  // =========================================================================
  // call.session_ended — updates room status + inserts log
  // =========================================================================

  it('call.session_ended updates room status to ended and inserts log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const streamCallId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    const { POST } = await import('@/app/api/webhooks/stream/video/route');
    const request = makeWebhookRequest({
      type: 'call.session_ended',
      call_cid: `default:${streamCallId}`,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Verify room status changed to 'ended'
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.status).toBe('ended');

    // Verify log entry was created
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('room_ended');
  });

  // =========================================================================
  // call.session_participant_joined — inserts log
  // =========================================================================

  it('call.session_participant_joined inserts log entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const streamCallId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    const { POST } = await import('@/app/api/webhooks/stream/video/route');
    const request = makeWebhookRequest({
      type: 'call.session_participant_joined',
      call_cid: `default:${streamCallId}`,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Verify log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('patient_joined');
    expect(logs[0]!.participantRole).toBe('patient');
  });

  // =========================================================================
  // call.session_participant_left — inserts log
  // =========================================================================

  it('call.session_participant_left inserts log entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const streamCallId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    const { POST } = await import('@/app/api/webhooks/stream/video/route');
    const request = makeWebhookRequest({
      type: 'call.session_participant_left',
      call_cid: `default:${streamCallId}`,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('patient_left');
    expect(logs[0]!.participantRole).toBe('patient');
  });

  // =========================================================================
  // call.recording_started — updates recording status
  // =========================================================================

  it('call.recording_started updates recording status to recording', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const streamCallId = await seedVideoRoom(userId, sessionId, { status: 'active' });
    await seedVideoRecording(userId, sessionId, { status: 'idle' });

    const { POST } = await import('@/app/api/webhooks/stream/video/route');
    const request = makeWebhookRequest({
      type: 'call.recording_started',
      call_cid: `default:${streamCallId}`,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.sessionId, sessionId));
    });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]!.status).toBe('recording');
    expect(recordings[0]!.recordedAt).not.toBeNull();
  });

  // =========================================================================
  // call.recording_stopped — updates recording status
  // =========================================================================

  it('call.recording_stopped updates recording status to processing', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const streamCallId = await seedVideoRoom(userId, sessionId, { status: 'active' });
    await seedVideoRecording(userId, sessionId, { status: 'recording' });

    const { POST } = await import('@/app/api/webhooks/stream/video/route');
    const request = makeWebhookRequest({
      type: 'call.recording_stopped',
      call_cid: `default:${streamCallId}`,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.sessionId, sessionId));
    });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]!.status).toBe('processing');
  });

  // =========================================================================
  // Idempotency — duplicate call.session_ended is harmless
  // =========================================================================

  it('duplicate call.session_ended is idempotent (room already ended)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const streamCallId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    const { POST } = await import('@/app/api/webhooks/stream/video/route');
    const payload = {
      type: 'call.session_ended',
      call_cid: `default:${streamCallId}`,
    };

    // First event — should update room + insert log
    const response1 = await POST(makeWebhookRequest(payload));
    expect(response1.status).toBe(200);

    // Second event — room is already 'ended', so no update, no new log
    const response2 = await POST(makeWebhookRequest(payload));
    expect(response2.status).toBe(200);

    // Room still ended (not duplicate entry)
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.status).toBe('ended');

    // Only 1 log entry (idempotent — the UPDATE...WHERE status='active'
    // matched 0 rows on the second call, so no log was inserted)
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
  });

  // =========================================================================
  // Unrecognized event type — accepted but not processed
  // =========================================================================

  it('unrecognized event type returns 200 without side effects', async () => {
    const { POST } = await import('@/app/api/webhooks/stream/video/route');

    const request = makeWebhookRequest({
      type: 'call.some_unknown_event',
      call_cid: 'default:unknown-call',
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});
