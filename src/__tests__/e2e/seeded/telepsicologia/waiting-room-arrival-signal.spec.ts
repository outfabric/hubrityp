import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { SEED_PATIENTS, readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @telepsicologia -- Waiting-room patient ARRIVAL SIGNAL E2E (sections 1-5).
 *
 * Drives the REAL, built, running route handlers `/api/video/join` and
 * `/api/video/depart` over HTTP against the seeded Next app, and asserts the
 * `video_rooms` liveness columns those handlers write — the exact server-render
 * source that seeds the psychologist's presence badge (`useVideoRoomPresence`
 * via `room.patientLastSeenAt`). This is a genuine end-to-end exercise of the
 * arrival-signal pipeline against the production build (integration tests import
 * the handler function directly; here we hit it over the network on `next
 * start`).
 *
 * ---------------------------------------------------------------------------
 * HONEST-SCOPE LIMITATION (read before "fixing" this to click the badge):
 *
 *   The psychologist's waiting badge ("<paciente> aguardando" + "Admitir")
 *   lives inside `InCallView`, which `CallStateRouter` (video-call-client.tsx)
 *   mounts ONLY at `CallingState.JOINED`. Reaching JOINED requires a live
 *   Stream WebSocket join handshake. The seeded suite has NO network path to
 *   Stream (only a server-side no-op token stub, `E2E_STREAM_STUB`); the client
 *   `StreamVideoClient` is the real SDK and never reaches JOINED here. The
 *   reachable psychologist surface is the PRE-CALL LOBBY (`CallingState.IDLE`).
 *
 *   This is the SAME documented limitation the patient-join transition test and
 *   the "psychologist in-call surface" test in `patient-join-flow.spec.ts`
 *   acknowledge with their [STREAM-MOCK] comments. We deliberately do NOT inject
 *   fake DOM or stub the client SDK to force a green JOINED assertion — that
 *   would mask whether the real badge renders (CLAUDE.md: forbid e2e DOM
 *   workarounds that false-pass CI).
 *
 *   Therefore the badge DOM itself is asserted by the co-located UNIT tests
 *   (real components, mocked Stream call-state hooks + fake timers):
 *     - badge logic (shown/hidden, departure clear, TTL auto-clear, post-admit
 *       clear): src/__tests__/unit/modules/telepsicologia/components/in-call-view-badge.test.tsx
 *     - presence hook (heartbeat freshness, null-departure, TTL, unmount):
 *       src/__tests__/unit/modules/telepsicologia/hooks/use-video-room-presence.test.ts
 *
 *   What IS genuinely exercisable end-to-end here, and what this spec covers, is
 *   the SERVER-RENDER SOURCE that drives the badge: the DB liveness columns
 *   produced by the real join/depart handlers. Each badge condition maps to a
 *   route-driven DB assertion:
 *     - no arrival            -> patient_last_seen_at IS NULL   (badge hidden)
 *     - arrival (waiting)     -> patient_last_seen_at fresh     (badge shown)
 *     - departure (beacon)    -> patient_last_seen_at -> NULL   (badge clears NOW)
 *     - no-beacon stop        -> DB keeps the stale timestamp   (TTL is CLIENT-side)
 *     - admit                 -> status -> 'active'             (badge gate closes)
 *
 *   Plus one authenticated BROWSER navigation proving the real `/sessao/:id/video`
 *   page server-renders an activated, patient-present room without error.
 * ---------------------------------------------------------------------------
 *
 * Prerequisites:
 *   - Seeded user + profile in global-setup.ts (psychologistName = 'Seed User').
 *   - Public token-gated routes — no Supabase auth required for join/depart.
 */

// ---------------------------------------------------------------------------
// Deterministic IDs — distinct from every other telepsicologia spec to avoid
// row / unique-token collisions under `fullyParallel`.
// ---------------------------------------------------------------------------

// Route-pipeline fixture (own dedicated session/room/patient + unique token).
const PIPELINE_SESSION_ID = '00000000-0000-4000-8000-0000000000a0';
const PIPELINE_VIDEO_ROOM_ID = '00000000-0000-4000-8000-0000000000a1';
const PIPELINE_PATIENT_ID = '00000000-0000-4000-8000-0000000000a2';
// 64-char hex, unique to this spec (patient_token has a UNIQUE index).
const PIPELINE_TOKEN = 'abcdef0123456789'.repeat(4);

// Browser-render fixture (own session/room; reuses the global seed patient).
const PAGE_SESSION_ID = '00000000-0000-4000-8000-0000000000b0';
const PAGE_VIDEO_ROOM_ID = '00000000-0000-4000-8000-0000000000b1';
const PAGE_TOKEN = '0123456789abcdef'.repeat(4);

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

type PresenceRow = {
  status: string;
  patient_waiting_at: Date | null;
  patient_last_seen_at: Date | null;
};

/** Open a short-lived connection, run `fn`, always close it. */
async function withSql<T>(fn: (sql: ReturnType<typeof pgModule>) => Promise<T>): Promise<T> {
  const seed = await readSeedState();
  const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Insert the pipeline patient + online session + activated pending room. */
async function seedPipelineRoom(): Promise<void> {
  const seed = await readSeedState();
  await withSql(async (sql) => {
    await sql`DELETE FROM public.video_session_logs WHERE session_id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.video_rooms WHERE session_id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.session_history WHERE session_id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.sessions WHERE id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.patients WHERE id = ${PIPELINE_PATIENT_ID}`;

    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status)
      VALUES (${PIPELINE_PATIENT_ID}, ${seed.userId}, 'Paciente Sinal Chegada', 'individual', 'active')
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, status = EXCLUDED.status;
    `;

    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id, start_at, end_at, duration_minutes,
        modality, status, is_blocking
      )
      VALUES (
        ${PIPELINE_SESSION_ID}, ${seed.userId}, ${PIPELINE_PATIENT_ID},
        now() + interval '30 minutes', now() + interval '1 hour 20 minutes', 50,
        'online', 'scheduled', false
      )
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
    `;

    // Activated (stream_call_id non-null) pending room, window straddling NOW so
    // /api/video/join lands in the 'waiting' branch (the only branch that writes
    // liveness). The 'waiting' branch never touches Stream — no SDK needed.
    await sql`
      INSERT INTO public.video_rooms (
        id, user_id, session_id, stream_call_id, patient_token,
        available_from, expires_at, status
      )
      VALUES (
        ${PIPELINE_VIDEO_ROOM_ID}, ${seed.userId}, ${PIPELINE_SESSION_ID},
        'e2e-arrival-signal-call', ${PIPELINE_TOKEN},
        now() - interval '5 minutes', now() + interval '2 hours', 'pending'
      )
      ON CONFLICT (id) DO UPDATE SET
        stream_call_id = EXCLUDED.stream_call_id,
        patient_token  = EXCLUDED.patient_token,
        available_from = EXCLUDED.available_from,
        expires_at     = EXCLUDED.expires_at,
        status         = EXCLUDED.status;
    `;
  });
}

/** Reset the pipeline room to a clean pending/no-presence state between tests. */
async function resetPipelineRoom(): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      UPDATE public.video_rooms
      SET status = 'pending', patient_last_seen_at = NULL, patient_waiting_at = NULL
      WHERE id = ${PIPELINE_VIDEO_ROOM_ID};
    `;
    await sql`
      DELETE FROM public.video_session_logs
      WHERE session_id = ${PIPELINE_SESSION_ID} AND event_type = 'patient_arrived';
    `;
  });
}

async function cleanupPipelineRoom(): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM public.video_session_logs WHERE session_id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.video_rooms WHERE session_id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.session_history WHERE session_id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.sessions WHERE id = ${PIPELINE_SESSION_ID}`;
    await sql`DELETE FROM public.patients WHERE id = ${PIPELINE_PATIENT_ID}`;
  });
}

async function readPipelinePresence(): Promise<PresenceRow> {
  return withSql(async (sql) => {
    const [row] = await sql<PresenceRow[]>`
      SELECT status, patient_waiting_at, patient_last_seen_at
      FROM public.video_rooms WHERE id = ${PIPELINE_VIDEO_ROOM_ID};
    `;
    if (!row) throw new Error(`pipeline room ${PIPELINE_VIDEO_ROOM_ID} not found`);
    return row;
  });
}

async function countArrivalLogs(): Promise<number> {
  return withSql(async (sql) => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.video_session_logs
      WHERE session_id = ${PIPELINE_SESSION_ID} AND event_type = 'patient_arrived';
    `;
    return row?.n ?? 0;
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers — hit the REAL running route handlers. Each request carries a
// unique x-forwarded-for so the per-IP rate limiter (10/min) never collides
// across tests in this file.
// ---------------------------------------------------------------------------

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.42.0.${ipCounter % 250}`;
}

// ---------------------------------------------------------------------------
// Route pipeline — patient join/depart drives the badge's server-render source
// (serial: every test mutates the same room row; serial avoids intra-file races
// that `fullyParallel` would otherwise introduce).
// ---------------------------------------------------------------------------

test.describe('@telepsicologia waiting-room arrival signal — route pipeline', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await seedPipelineRoom();
  });

  test.beforeEach(async () => {
    await resetPipelineRoom();
  });

  test.afterAll(async () => {
    await cleanupPipelineRoom();
  });

  test('negative: no arrival → no liveness recorded (badge would be hidden)', async () => {
    // No patient has polled /api/video/join. The server-render source that
    // seeds `useVideoRoomPresence` is empty → the psychologist badge stays
    // hidden (`isPatientPresent === false`).
    const presence = await readPipelinePresence();
    expect(presence.status).toBe('pending');
    expect(presence.patient_waiting_at).toBeNull();
    expect(presence.patient_last_seen_at).toBeNull();
    expect(await countArrivalLogs()).toBe(0);
  });

  test('arrival: first waiting poll records heartbeat + one audit row (badge would show)', async ({
    request,
  }) => {
    const before = Date.now();
    const res = await request.post('/api/video/join', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Status is 'waiting' and the body leaks nothing beyond the three allowed
    // fields — no tokens/jwt/internal ids reach the patient over the wire.
    expect(body.status).toBe('waiting');
    expect(Object.keys(body).sort()).toEqual([
      'psychologistName',
      'psychologistPhotoUrl',
      'status',
    ]);
    expect(body.psychologistName).toBe('Seed User');

    // The waiting poll stamped BOTH columns to one server `now()`, and inserted
    // exactly one first-arrival audit row. A fresh `patient_last_seen_at` within
    // the TTL is precisely the badge-shown condition.
    const presence = await readPipelinePresence();
    expect(presence.status).toBe('pending');
    expect(presence.patient_waiting_at).not.toBeNull();
    expect(presence.patient_last_seen_at).not.toBeNull();
    expect(presence.patient_last_seen_at!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(await countArrivalLogs()).toBe(1);
  });

  test('continuity: repeated polls advance the heartbeat without re-logging arrival', async ({
    request,
  }) => {
    const firstRes = await request.post('/api/video/join', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });
    expect(firstRes.status()).toBe(200);
    const afterFirst = await readPipelinePresence();
    const waitingAt = afterFirst.patient_waiting_at!.getTime();
    const firstSeen = afterFirst.patient_last_seen_at!.getTime();

    // A later poll (the 10s heartbeat) re-stamps liveness; the immutable
    // first-arrival anchor stays fixed and no duplicate audit row appears.
    const secondRes = await request.post('/api/video/join', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });
    expect(secondRes.status()).toBe(200);

    const afterSecond = await readPipelinePresence();
    expect(afterSecond.patient_waiting_at!.getTime()).toBe(waitingAt);
    expect(afterSecond.patient_last_seen_at!.getTime()).toBeGreaterThanOrEqual(firstSeen);
    expect(await countArrivalLogs()).toBe(1);
  });

  test('departure beacon clears liveness IMMEDIATELY — distinct from the TTL path', async ({
    request,
  }) => {
    await request.post('/api/video/join', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });
    expect((await readPipelinePresence()).patient_last_seen_at).not.toBeNull();

    // The real `pagehide` beacon endpoint nulls the heartbeat synchronously —
    // the psychologist badge would clear on the next broadcast/render WITHOUT
    // waiting out the 30s TTL. The first-arrival audit marker is preserved.
    const res = await request.post('/api/video/depart', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });
    expect(res.status()).toBe(204);

    const presence = await readPipelinePresence();
    expect(presence.patient_last_seen_at).toBeNull();
    expect(presence.patient_waiting_at).not.toBeNull();
  });

  test('early-arrive-then-leave: audit retained, no live presence (no stale badge)', async ({
    request,
  }) => {
    await request.post('/api/video/join', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });
    await request.post('/api/video/depart', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });

    // The patient arrived once (audit anchor set) but is no longer live: the
    // badge's server-render source is empty, so no stale "aguardando" lingers.
    const presence = await readPipelinePresence();
    expect(presence.patient_waiting_at).not.toBeNull();
    expect(presence.patient_last_seen_at).toBeNull();

    // A duplicate beacon is idempotent (already-null heartbeat, zero rows).
    const dupe = await request.post('/api/video/depart', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });
    expect(dupe.status()).toBe(204);
    expect((await readPipelinePresence()).patient_last_seen_at).toBeNull();
  });

  test('no-beacon path: route layer never auto-clears — TTL is client-side (unit-covered)', async ({
    request,
  }) => {
    await request.post('/api/video/join', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });

    // When a patient closes the tab WITHOUT the beacon firing, heartbeats simply
    // stop. The DB keeps the last (now-stale) `patient_last_seen_at` — the route
    // layer does NOT expire it. The auto-clear after the TTL is therefore a
    // CLIENT-side freshness computation in `useVideoRoomPresence`
    // (`Date.now() - lastSeenAt >= WAITING_PRESENCE_TTL_MS`), which cannot be
    // driven through the route layer and is covered with an injectable TTL +
    // fake timers by the hook + badge unit tests (sections 5.3 / 5.5). Asserting
    // the DB retains the stale timestamp documents exactly why the TTL must live
    // client-side.
    const presence = await readPipelinePresence();
    expect(presence.patient_last_seen_at).not.toBeNull();
  });

  test('post-admit: room goes active → server-render badge gate closes', async ({ request }) => {
    await request.post('/api/video/join', {
      data: { token: PIPELINE_TOKEN },
      headers: { 'x-forwarded-for': nextIp() },
    });

    // Simulate the psychologist admitting (the admit Server Action flips the
    // room to 'active'; we apply the same DB transition the action makes, as the
    // existing patient-join transition test does). The badge gate is
    // `room.status === 'pending' && isPatientPresent` — once status is 'active'
    // the gate is closed regardless of liveness. The IMMEDIATE local latch
    // (`setAdmitted(true)` before the page reloads) is covered by the badge unit
    // test (section 5.5).
    await withSql(async (sql) => {
      await sql`UPDATE public.video_rooms SET status = 'active' WHERE id = ${PIPELINE_VIDEO_ROOM_ID}`;
    });

    const presence = await readPipelinePresence();
    expect(presence.status).toBe('active');
    // The arrival audit + heartbeat are untouched by admission; only `status`
    // gates the badge now.
    expect(presence.patient_last_seen_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Browser navigation — the real authenticated psychologist page server-renders
// an activated, patient-present room without error. This proves the page query
// selects the new `patient_last_seen_at` column and passes the full room row to
// the client (the seed for `useVideoRoomPresence`). The in-call badge DOM itself
// is JOINED-only (see the limitation block above) and unit-covered.
// ---------------------------------------------------------------------------

async function seedPageRoomWithPatientPresent(): Promise<void> {
  const seed = await readSeedState();
  await withSql(async (sql) => {
    await sql`DELETE FROM public.video_rooms WHERE session_id = ${PAGE_SESSION_ID}`;
    await sql`DELETE FROM public.session_history WHERE session_id = ${PAGE_SESSION_ID}`;
    await sql`DELETE FROM public.sessions WHERE id = ${PAGE_SESSION_ID}`;

    // Online session owned by the seeded psychologist, reusing the global seed
    // patient (Maria Silva) so no extra patient row is needed.
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id, start_at, end_at, duration_minutes,
        modality, status, is_blocking
      )
      VALUES (
        ${PAGE_SESSION_ID}, ${seed.userId}, ${SEED_PATIENTS.activeWithPhone.id},
        now() + interval '30 minutes', now() + interval '1 hour 20 minutes', 50,
        'online', 'scheduled', false
      )
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, modality = EXCLUDED.modality;
    `;

    // Activated pending room with the patient already present (heartbeat set).
    await sql`
      INSERT INTO public.video_rooms (
        id, user_id, session_id, stream_call_id, patient_token,
        available_from, expires_at, status, patient_waiting_at, patient_last_seen_at
      )
      VALUES (
        ${PAGE_VIDEO_ROOM_ID}, ${seed.userId}, ${PAGE_SESSION_ID},
        'e2e-arrival-page-call', ${PAGE_TOKEN},
        now() - interval '5 minutes', now() + interval '2 hours', 'pending',
        now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        stream_call_id       = EXCLUDED.stream_call_id,
        patient_token        = EXCLUDED.patient_token,
        available_from       = EXCLUDED.available_from,
        expires_at           = EXCLUDED.expires_at,
        status               = EXCLUDED.status,
        patient_waiting_at   = EXCLUDED.patient_waiting_at,
        patient_last_seen_at = EXCLUDED.patient_last_seen_at;
    `;
  });
}

test.describe('@telepsicologia waiting-room arrival signal — psychologist page render', () => {
  test.use({ storageState: STORAGE_STATE_PATH });
  test.setTimeout(45_000);

  test.afterAll(async () => {
    await withSql(async (sql) => {
      await sql`DELETE FROM public.video_rooms WHERE session_id = ${PAGE_SESSION_ID}`;
      await sql`DELETE FROM public.session_history WHERE session_id = ${PAGE_SESSION_ID}`;
      await sql`DELETE FROM public.sessions WHERE id = ${PAGE_SESSION_ID}`;
    });
  });

  test('renders the lobby for an activated, patient-present room (server-render wiring intact)', async ({
    page,
    context,
  }) => {
    await seedPageRoomWithPatientPresent();

    await context.grantPermissions(['camera', 'microphone'], {
      origin: 'http://localhost:3000',
    });
    // No Stream backend in this harness — block its traffic; the client stays in
    // CallingState.IDLE (lobby), the reachable surface.
    await page.route(/\.(stream-io-api\.com|getstream\.io)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ duration: '0ms' }),
      }),
    );
    await page.route('**/api/video/log', (route) => route.fulfill({ status: 200, body: '{}' }));

    await page.goto(`/sessao/${PAGE_SESSION_ID}/video`);

    // The page RSC ran its query (now selecting `patient_last_seen_at`) and
    // handed the full room row to the client without error: the lobby's
    // "Entrar na sessão" CTA renders. The in-call waiting badge is JOINED-only
    // and asserted by the unit tests (see the limitation block above).
    await expect(page.getByTestId('join-call-button')).toBeVisible({ timeout: 20_000 });
  });
});
