import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  videoRecordings,
  videoRooms,
  videoSessionLogs,
} from '@/shared/db/schema/telepsicologia/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Realtime-availability detection
//
// The shared Testcontainers image is plain `postgres:16-alpine` — it has NO
// `realtime` schema and no `realtime.send`, so the migration's broadcast
// objects (trigger function, trigger, `realtime.messages` policy) are created
// inside a `DO $$ … IF EXISTS (realtime schema / realtime.send) … $$` guard
// that no-ops there. These helpers let each test branch: assert the guard
// no-op on plain Postgres, or exercise the real trigger when the suite happens
// to run against a Supabase-provisioned database.
// ---------------------------------------------------------------------------

async function realtimeSendAvailable(): Promise<boolean> {
  const rows = await runAsService((db) =>
    db.execute(dsql`
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'realtime' AND p.proname = 'send'
      ) AS present`),
  );
  return rows[0]!.present === true;
}

async function triggerExists(): Promise<boolean> {
  const rows = await runAsService((db) =>
    db.execute(dsql`
      SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'video_rooms_presence_broadcast' AND NOT tgisinternal
      ) AS present`),
  );
  return rows[0]!.present === true;
}

async function functionExists(): Promise<boolean> {
  const rows = await runAsService((db) =>
    db.execute(dsql`
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'broadcast_video_room_presence'
      ) AS present`),
  );
  return rows[0]!.present === true;
}

// ---------------------------------------------------------------------------
// Fixtures
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
    await db.insert(patients).values({ id: patientId, userId, fullName: 'Test Patient' });
  });
}

async function seedSession(userId: string, sessionId: string, patientId: string): Promise<void> {
  const now = new Date();
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: new Date(now.getTime() + 3600_000),
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });
  });
}

/**
 * Seeds owner + patient + online session + a pending room. The room carries a
 * populated patient JWT and token so the "payload leaks no credentials"
 * assertions are meaningful (the trigger must never emit them).
 */
async function seedRoom(): Promise<{ userId: string; roomId: string }> {
  const userId = randomUUID();
  const patientId = randomUUID();
  const sessionId = randomUUID();
  const roomId = randomUUID();
  await seedAuthUser(userId);
  await seedPatient(userId, patientId);
  await seedSession(userId, sessionId, patientId);

  const now = new Date();
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: roomId,
      userId,
      sessionId,
      streamCallId: `call_${randomUUID()}`,
      patientToken: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      patientJwt: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.secret.patient',
      availableFrom: now,
      expiresAt: new Date(now.getTime() + 7200_000),
      status: 'pending',
    });
  });

  return { userId, roomId };
}

async function broadcastsForTopic(topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await runAsService((db) =>
    db.execute(dsql`
      SELECT m.payload, m.event, m.extension
      FROM realtime.messages m
      WHERE m.topic = ${topic}
      ORDER BY m.inserted_at`),
  );
  return rows;
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(videoRecordings);
    await db.delete(videoSessionLogs);
    await db.delete(videoRooms);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// 2.4 — trigger firing (when realtime is available) / guard no-op (plain pg)
// =====================================================================

describe('video_rooms presence broadcast — trigger', () => {
  it('is a no-op on plain Postgres without the realtime schema (guard skips trigger/function)', async (ctx) => {
    // On a real Supabase stack the guard creates the objects; this no-op
    // contract only applies to the Testcontainers `postgres:16-alpine` image.
    if (await realtimeSendAvailable()) {
      ctx.skip();
      return;
    }

    // The migration applied cleanly (the suite is running), and the guard left
    // the broadcast objects uncreated on a realtime-less Postgres.
    expect(await triggerExists()).toBe(false);
    expect(await functionExists()).toBe(false);
  });

  it('broadcasts a minimal { room_id, last_seen_at } payload on a heartbeat change — no jwt/token/PII', async (ctx) => {
    // Requires the `realtime` schema; documented skip on plain Postgres
    // (Testcontainers image lacks it — see CLAUDE.md "state it explicitly").
    if (!(await realtimeSendAvailable())) {
      ctx.skip();
      return;
    }

    const { roomId } = await seedRoom();
    const topic = `video-room:${roomId}`;
    const lastSeen = new Date('2026-06-26T12:00:30.000Z');

    await runAsService((db) =>
      db.execute(
        dsql`UPDATE video_rooms SET patient_last_seen_at = ${lastSeen} WHERE id = ${roomId}`,
      ),
    );

    const messages = await broadcastsForTopic(topic);
    expect(messages).toHaveLength(1);

    const message = messages[0]!;
    expect(message.extension).toBe('broadcast');
    const payload = message.payload as Record<string, unknown>;
    // Payload carries ONLY the room id and the liveness timestamp.
    expect(Object.keys(payload).sort()).toEqual(['last_seen_at', 'room_id']);
    expect(payload.room_id).toBe(roomId);
    expect(payload.last_seen_at).not.toBeNull();

    // Defense-in-depth: the serialized payload must never contain credentials.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('secret.patient');
    expect(serialized.toLowerCase()).not.toContain('jwt');
    expect(serialized.toLowerCase()).not.toContain('token');
  });

  it('broadcasts last_seen_at: null on departure (heartbeat cleared to NULL)', async (ctx) => {
    if (!(await realtimeSendAvailable())) {
      ctx.skip();
      return;
    }

    const { roomId } = await seedRoom();
    const topic = `video-room:${roomId}`;

    // Arrive, then depart.
    await runAsService((db) =>
      db.execute(
        dsql`UPDATE video_rooms SET patient_last_seen_at = ${new Date('2026-06-26T12:00:30.000Z')} WHERE id = ${roomId}`,
      ),
    );
    await runAsService((db) =>
      db.execute(dsql`UPDATE video_rooms SET patient_last_seen_at = NULL WHERE id = ${roomId}`),
    );

    const messages = await broadcastsForTopic(topic);
    // Two heartbeat transitions => two broadcasts; the last is the departure.
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const departure = messages[messages.length - 1]!.payload as Record<string, unknown>;
    expect(Object.keys(departure).sort()).toEqual(['last_seen_at', 'room_id']);
    expect(departure.room_id).toBe(roomId);
    expect(departure.last_seen_at).toBeNull();
  });

  it('stays silent when an update does not change patient_last_seen_at (status-only change)', async (ctx) => {
    if (!(await realtimeSendAvailable())) {
      ctx.skip();
      return;
    }

    const { roomId } = await seedRoom();
    const topic = `video-room:${roomId}`;

    // Status flips to active but the heartbeat column is untouched.
    await runAsService((db) =>
      db.execute(dsql`UPDATE video_rooms SET status = 'active' WHERE id = ${roomId}`),
    );

    const messages = await broadcastsForTopic(topic);
    expect(messages).toHaveLength(0);
  });
});

// =====================================================================
// 2.5 — realtime.messages RLS receive policy (owner vs non-owner)
//
// The `realtime.messages` policy gates receipt of the presence broadcast at
// channel-join time over a WebSocket — that cannot be driven headlessly in the
// Testcontainers stack (no `realtime` schema, no Realtime server). We instead
// assert the policy's authorization PREDICATE directly: the `EXISTS (... FROM
// public.video_rooms vr WHERE vr.user_id = auth.uid() AND <topic matches>)`
// subquery, evaluated under the connecting user's role. `realtime.topic()` is
// substituted by the literal topic (it reads request context unavailable
// here); `video_rooms` RLS still applies, so a non-owner cannot see the row and
// the predicate denies — exactly the production outcome.
// =====================================================================

async function topicAuthorized(jwtSub: string, topic: string): Promise<boolean> {
  const rows = await runAsUser(jwtSub, (db) =>
    db.execute(dsql`
      SELECT EXISTS (
        SELECT 1 FROM public.video_rooms vr
        WHERE vr.user_id = auth.uid()
          AND ${topic} = 'video-room:' || vr.id::text
      ) AS authorized`),
  );
  return rows[0]!.authorized === true;
}

describe('realtime.messages presence policy — owner-scoped receive predicate', () => {
  it('authorizes the room owner for their own video-room topic', async () => {
    const { userId, roomId } = await seedRoom();
    expect(await topicAuthorized(userId, `video-room:${roomId}`)).toBe(true);
  });

  it('denies a different authenticated user for the owner room topic (negative-auth)', async () => {
    const { roomId } = await seedRoom();
    const otherUserId = randomUUID();
    await seedAuthUser(otherUserId);

    expect(await topicAuthorized(otherUserId, `video-room:${roomId}`)).toBe(false);
  });

  it('denies the owner for a topic of a room they do not own', async () => {
    const { userId } = await seedRoom();
    const foreign = await seedRoom();

    expect(await topicAuthorized(userId, `video-room:${foreign.roomId}`)).toBe(false);
  });
});
