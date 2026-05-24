import crypto from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import {
  videoRecordings,
  videoRooms,
  videoSessionLogs,
} from '@/shared/db/schema/telepsicologia/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Zod schemas — validate the webhook payload at the boundary
// ---------------------------------------------------------------------------

/** Base schema: every Stream webhook event carries a `type` field. */
const baseEventSchema = z.object({
  type: z.string().min(1),
  // Stream calls carry the call CID (type:id) — extract when present.
  call_cid: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the Stream webhook signature using HMAC-SHA256.
 *
 * Algorithm (documented in Stream SDK source, `verifySignature`):
 *   1. Compute HMAC-SHA256(body, secret) producing a hex digest.
 *   2. Constant-time compare with the value from `x-signature` header.
 *
 * Uses `crypto.timingSafeEqual` to prevent timing attacks.
 */
function verifyStreamSignature(body: string, signature: string, secret: string): boolean {
  const key = Buffer.from(secret, 'utf8');
  const hash = crypto.createHmac('sha256', key).update(body).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    // timingSafeEqual throws if buffer lengths differ — always invalid.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event handlers — each mutates the DB via service-role (justified: this is
// an external webhook, no user session exists).
// ---------------------------------------------------------------------------

/**
 * Extract the Stream call ID from a `call_cid` field (format: "default:<id>").
 * Falls back to the raw value when no colon separator is present.
 */
function extractCallId(callCid: string): string {
  const colonIndex = callCid.indexOf(':');
  return colonIndex >= 0 ? callCid.slice(colonIndex + 1) : callCid;
}

async function handleSessionEnded(callCid: string): Promise<void> {
  const streamCallId = extractCallId(callCid);

  // Find the room to get sessionId and userId for the log entry.
  const rooms = await db
    .update(videoRooms)
    .set({ status: 'ended' })
    .where(and(eq(videoRooms.streamCallId, streamCallId), eq(videoRooms.status, 'active')))
    .returning({ sessionId: videoRooms.sessionId, userId: videoRooms.userId });

  if (rooms.length > 0) {
    const room = rooms[0]!;
    await db.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId: room.userId,
      eventType: 'room_ended',
      // No participantRole — this is a system-level event.
    });
  }

  logger.info(
    { event: 'stream_webhook_session_ended', hasRoom: rooms.length > 0 },
    'Processed call.session_ended',
  );
}

async function handleParticipantJoined(callCid: string): Promise<void> {
  const streamCallId = extractCallId(callCid);

  // Look up the room to get sessionId + userId for the log entry.
  const rooms = await db
    .select({ sessionId: videoRooms.sessionId, userId: videoRooms.userId })
    .from(videoRooms)
    .where(eq(videoRooms.streamCallId, streamCallId))
    .limit(1);

  if (rooms.length > 0) {
    const room = rooms[0]!;
    await db.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId: room.userId,
      eventType: 'patient_joined',
      participantRole: 'patient',
    });
  }

  logger.info(
    { event: 'stream_webhook_participant_joined', hasRoom: rooms.length > 0 },
    'Processed call.session_participant_joined',
  );
}

async function handleParticipantLeft(callCid: string): Promise<void> {
  const streamCallId = extractCallId(callCid);

  const rooms = await db
    .select({ sessionId: videoRooms.sessionId, userId: videoRooms.userId })
    .from(videoRooms)
    .where(eq(videoRooms.streamCallId, streamCallId))
    .limit(1);

  if (rooms.length > 0) {
    const room = rooms[0]!;
    await db.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId: room.userId,
      eventType: 'patient_left',
      participantRole: 'patient',
    });
  }

  logger.info(
    { event: 'stream_webhook_participant_left', hasRoom: rooms.length > 0 },
    'Processed call.session_participant_left',
  );
}

async function handleRecordingStarted(callCid: string): Promise<void> {
  const streamCallId = extractCallId(callCid);

  // Find the room to look up the associated recording.
  const rooms = await db
    .select({ sessionId: videoRooms.sessionId })
    .from(videoRooms)
    .where(eq(videoRooms.streamCallId, streamCallId))
    .limit(1);

  if (rooms.length > 0) {
    const room = rooms[0]!;
    await db
      .update(videoRecordings)
      .set({ status: 'recording', recordedAt: sql`now()` })
      .where(
        and(eq(videoRecordings.sessionId, room.sessionId), eq(videoRecordings.status, 'idle')),
      );
  }

  logger.info(
    { event: 'stream_webhook_recording_started', hasRoom: rooms.length > 0 },
    'Processed call.recording_started',
  );
}

async function handleRecordingStopped(callCid: string): Promise<void> {
  const streamCallId = extractCallId(callCid);

  const rooms = await db
    .select({ sessionId: videoRooms.sessionId })
    .from(videoRooms)
    .where(eq(videoRooms.streamCallId, streamCallId))
    .limit(1);

  if (rooms.length > 0) {
    const room = rooms[0]!;
    await db
      .update(videoRecordings)
      .set({ status: 'processing' })
      .where(
        and(eq(videoRecordings.sessionId, room.sessionId), eq(videoRecordings.status, 'recording')),
      );
  }

  logger.info(
    { event: 'stream_webhook_recording_stopped', hasRoom: rooms.length > 0 },
    'Processed call.recording_stopped',
  );
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/stream/video
 *
 * Receives Stream Video webhook events. The handler:
 *
 *   1. Reads raw body for HMAC validation
 *   2. Validates signature using STREAM_WEBHOOK_SECRET + crypto.timingSafeEqual
 *   3. Parses payload + Zod-validates the structure
 *   4. Routes by event type:
 *      - call.session_ended → update room status + insert log
 *      - call.session_participant_joined → insert log
 *      - call.session_participant_left → insert log
 *      - call.recording_started → update recording status
 *      - call.recording_stopped → update recording status
 *   5. Returns 200
 *
 * Uses service-role (Drizzle db client, which bypasses RLS) for DB writes.
 * Justified: this is an external webhook with no user session — the request
 * is authenticated via HMAC signature, not a JWT.
 *
 * Never logs payload content — may contain participant info (PII).
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Step 1: Read raw body for HMAC validation
  const rawBody = await request.text();

  // Step 2: Validate signature
  const signature = request.headers.get('x-signature') ?? '';
  const webhookSecret = serverEnv.STREAM_WEBHOOK_SECRET;

  if (!verifyStreamSignature(rawBody, signature, webhookSecret)) {
    logger.warn(
      { event: 'stream_webhook_invalid_signature' },
      'Invalid Stream webhook signature — rejecting request',
    );
    return new Response('Forbidden', { status: 403 });
  }

  // Step 3: Parse and validate payload structure
  let payload: z.infer<typeof baseEventSchema>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    const result = baseEventSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        { event: 'stream_webhook_malformed_payload' },
        'Stream webhook payload failed Zod validation',
      );
      return new Response('Bad Request', { status: 400 });
    }
    payload = result.data;
  } catch {
    logger.warn({ event: 'stream_webhook_invalid_json' }, 'Stream webhook body is not valid JSON');
    return new Response('Bad Request', { status: 400 });
  }

  // Step 4: Route by event type
  const eventType = payload.type;
  const callCid = payload.call_cid;

  try {
    switch (eventType) {
      case 'call.session_ended':
        if (callCid) await handleSessionEnded(callCid);
        break;
      case 'call.session_participant_joined':
        if (callCid) await handleParticipantJoined(callCid);
        break;
      case 'call.session_participant_left':
        if (callCid) await handleParticipantLeft(callCid);
        break;
      case 'call.recording_started':
        if (callCid) await handleRecordingStarted(callCid);
        break;
      case 'call.recording_stopped':
        if (callCid) await handleRecordingStopped(callCid);
        break;
      default:
        // Unrecognized event types are acknowledged but not processed.
        logger.info(
          { event: 'stream_webhook_unrecognized_type', eventType },
          'Unrecognized Stream webhook event type — ignoring',
        );
        break;
    }
  } catch (err: unknown) {
    // Log but still return 200 to prevent Stream from retrying indefinitely.
    logger.error(
      {
        event: 'stream_webhook_handler_failed',
        eventType,
        errorName: err instanceof Error ? err.name : 'UnknownError',
      },
      'Failed to process Stream webhook event',
    );
  }

  // Step 5: Return 200
  return new Response('OK', { status: 200 });
}
