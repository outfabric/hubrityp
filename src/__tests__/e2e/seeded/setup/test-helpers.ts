// Helpers shared across seeded e2e specs that need to:
//
//   • Seed users (lifecycle-driven) directly into the Testcontainers Postgres
//     exposed by `start-server.ts`.
//   • Register email/password mappings into the mock GoTrue's credential
//     registry so a subsequent `signInWithPassword` call from the webServer
//     process resolves to the right user.
//   • Drive lifecycle transitions and admin Server Actions (CRP approve /
//     reject) directly from a spec, bypassing UI-level OAuth callbacks the
//     mock cannot replay (PKCE).
//
// We intentionally do NOT import server-only modules from this file:
// Playwright runs spec.ts files in a Node context where `import 'server-only'`
// throws (the runtime guard in the package), and Playwright has no module
// alias system to stub it out the way Vitest does. So the lifecycle SQL is
// written by hand here. The DB triggers
//   - `psychologist_profiles_set_timestamps` (BEFORE UPDATE)
//   - `psychologist_profiles_mirror_status` (AFTER UPDATE OF status)
// handle the `status_changed_at` / `updated_at` advances and the JWT
// app_metadata mirror automatically — exactly the same way they do under
// `applyTransition`. Mirroring the state-machine table here is a known
// drift risk; the integration tests for `applyTransition` and the
// `users` factory are the contract enforcers, this file is just a means
// to drive seeded fixtures into the same end states for E2E.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { readSeedState } from './seed-state';

// Registers an email/password/userId triple in the mock GoTrue's credential
// store. Subsequent `signInWithPassword` calls from the webServer process
// resolve to a real session for this user.
//
// `emailConfirmed` defaults to true so the issued user payload claims a
// confirmed email — the e2e dashboard test expects `signInWithPassword` to
// succeed without going through the email-confirmation step. Tests that
// want to exercise the unconfirmed path can pass `false`.
export async function registerMockCredentials(args: {
  email: string;
  password: string;
  userId: string;
  emailConfirmed?: boolean;
}): Promise<void> {
  const seed = await readSeedState();
  const url = `${seed.supabaseUrl}/__test/register-credentials`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: args.email,
      password: args.password,
      userId: args.userId,
      emailConfirmed: args.emailConfirmed ?? true,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`mock-gotrue register-credentials failed (${response.status}): ${text}`);
  }
}

// Removes a user from the mock GoTrue's registries by id. Idempotent.
export async function removeMockUser(userId: string): Promise<void> {
  const seed = await readSeedState();
  const url = `${seed.supabaseUrl}/__test/remove-user`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`mock-gotrue remove-user failed (${response.status}): ${text}`);
  }
}

export type SeededE2eUser = {
  userId: string;
  email: string;
  password: string;
  crpNumber: string;
  crpUf: string;
  fullName: string;
};

type SeedTarget =
  | 'pending_verification'
  | 'pending_crp_validation'
  | 'active'
  | 'suspended'
  | 'cancelled';

type SeedOptions = Partial<Omit<SeededE2eUser, 'userId'>> & { userId?: string };

// Pinned consent versions — must match `documentVersions` in
// `src/modules/account-lifecycle/lib/document-versions.ts`. We re-pin here
// rather than importing because that module is fine to import from a Node
// context (no `server-only`), but keeping it inline keeps this helper free of
// any module dependency that might change. If the canonical versions change,
// the unit/integration tests that read them from the canonical source will
// catch the drift; this file is e2e fixture scaffolding.
const CONSENT_VERSION = '2026-05';

async function withSeedDb<T>(fn: (db: PostgresJsDatabase) => Promise<T>): Promise<T> {
  const seed = await readSeedState();
  const sqlClient = postgres(seed.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sqlClient);
  try {
    return await fn(db);
  } finally {
    await sqlClient.end();
  }
}

async function insertProfile(input: SeededE2eUser): Promise<void> {
  await withSeedDb(async (db) => {
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${input.userId}, ${input.email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(sql`
      INSERT INTO psychologist_profiles (
        user_id, full_name, crp_number, crp_uf, status,
        terms_accepted_at, privacy_accepted_at, sensitive_data_consent_at,
        terms_version, privacy_version, sensitive_data_consent_version
      ) VALUES (
        ${input.userId}, ${input.fullName}, ${input.crpNumber}, ${input.crpUf},
        'pending_verification', now(), now(), now(),
        ${CONSENT_VERSION}, ${CONSENT_VERSION}, ${CONSENT_VERSION}
      )
    `);
  });
}

// Direct status update. The BEFORE-UPDATE trigger advances
// `status_changed_at` and `updated_at`, and the AFTER-UPDATE trigger mirrors
// the new status into `auth.users.raw_app_meta_data`. This is the same path
// `applyTransition` takes; the only difference is that the state-machine
// validity check is moved into the test helpers below (we know the chain
// each `seedE2eUser(target)` walks through).
async function setStatus(db: PostgresJsDatabase, userId: string, next: SeedTarget): Promise<void> {
  await db.execute(
    sql`UPDATE psychologist_profiles SET status = ${next} WHERE user_id = ${userId}`,
  );
}

// Drives the canonical lifecycle chain for `target`, applied via raw SQL
// UPDATEs. Each step mirrors the transition table in
// `src/modules/account-lifecycle/lib/state-machine.ts`:
//
//   pending_verification → email_verified → pending_crp_validation
//   pending_crp_validation → crp_approved → active
//   pending_crp_validation → crp_rejected → suspended
//   active → user_cancel → cancelled
//
// We do NOT call `applyTransition` here (it imports `server-only`).
async function driveTo(target: SeedTarget, userId: string): Promise<void> {
  if (target === 'pending_verification') return;
  await withSeedDb(async (db) => {
    if (target === 'pending_crp_validation') {
      await setStatus(db, userId, 'pending_crp_validation');
      return;
    }
    if (target === 'active') {
      await setStatus(db, userId, 'pending_crp_validation');
      await setStatus(db, userId, 'active');
      return;
    }
    if (target === 'suspended') {
      await setStatus(db, userId, 'pending_crp_validation');
      await setStatus(db, userId, 'suspended');
      return;
    }
    if (target === 'cancelled') {
      await setStatus(db, userId, 'pending_crp_validation');
      await setStatus(db, userId, 'active');
      await setStatus(db, userId, 'cancelled');
      return;
    }
  });
}

// Generates the test user identity. Email and CRP carry suffixes derived
// from the userId so collisions across parallel specs are impossible.
function buildIdentity(target: SeedTarget, options: SeedOptions): SeededE2eUser {
  const userId = options.userId ?? randomUUID();
  const suffix = userId.slice(0, 8);
  const email = options.email ?? `${target}-${suffix}@test.local`;
  const password = options.password ?? 'Senha!Forte9';
  const crpNumber =
    options.crpNumber ?? `06/${String(Math.floor(100000 + Math.random() * 900000))}`;
  const crpUf = options.crpUf ?? 'SP';
  const fullName = options.fullName ?? `Dra. ${target} ${suffix}`;
  return { userId, email, password, crpNumber, crpUf, fullName };
}

// Public seed helpers. Each one inserts the profile + auth.users row, drives
// the lifecycle to the target status, and registers the credentials with the
// mock GoTrue so a subsequent `signInWithPassword` succeeds.
export async function seedE2eUser(
  target: SeedTarget,
  options: SeedOptions = {},
): Promise<SeededE2eUser> {
  const identity = buildIdentity(target, options);
  await insertProfile(identity);
  await driveTo(target, identity.userId);
  await registerMockCredentials({
    email: identity.email,
    password: identity.password,
    userId: identity.userId,
  });
  return identity;
}

// Seed a user AND a `crp_validation_queue` row pointing at them. Used by
// admin-flow specs (CRP approval). The queue row is inserted at status
// `pending`. Returns the queue id so the spec can call
// `approveCrpFromTest` / `rejectCrpFromTest` against it.
export async function seedE2eUserWithQueue(
  target: 'pending_crp_validation',
  options: SeedOptions = {},
): Promise<SeededE2eUser & { queueId: string }> {
  const user = await seedE2eUser(target, options);
  const queueId = randomUUID();
  await withSeedDb(async (db) => {
    await db.execute(sql`
      INSERT INTO crp_validation_queue (id, user_id, crp_number, crp_uf, status)
      VALUES (${queueId}, ${user.userId}, ${user.crpNumber}, ${user.crpUf}, 'pending')
    `);
  });
  return { ...user, queueId };
}

// Drive the `crp_approved` transition through the same DB writes the admin
// Server Action would emit:
//   1. UPDATE crp_validation_queue (status, decided_at, decided_by) where pending
//   2. UPDATE psychologist_profiles SET status = 'active'
// The AFTER-UPDATE trigger mirrors the new status into `auth.users`. This
// is intentionally not the production code path (we do not exercise the
// `approveCrpValidation` Server Action's `forbidden`/`already_decided` gates)
// because that helper is `server-only` and cannot be imported here; the
// integration tests cover those branches.
export async function approveCrpFromTest(args: {
  queueId: string;
  actorUserId: string;
}): Promise<void> {
  await withSeedDb(async (db) => {
    const queue = await db.execute<{ user_id: string; status: string }>(
      sql`SELECT user_id, status FROM crp_validation_queue WHERE id = ${args.queueId}`,
    );
    const row = queue[0];
    if (!row) throw new Error(`approveCrpFromTest: queue row ${args.queueId} not found`);
    if (row.status !== 'pending') {
      throw new Error(
        `approveCrpFromTest: queue row ${args.queueId} is ${row.status}, not pending`,
      );
    }
    await db.execute(sql`
      UPDATE crp_validation_queue
         SET status = 'approved', decided_at = now(), decided_by = ${args.actorUserId}
       WHERE id = ${args.queueId}
    `);
    await db.execute(sql`
      UPDATE psychologist_profiles SET status = 'active' WHERE user_id = ${row.user_id}
    `);
  });
}

// Drive the `crp_rejected` transition. Mirrors `approveCrpFromTest` but
// writes `status = 'rejected'`, captures the rejection reason, and pushes
// the profile into `suspended`.
export async function rejectCrpFromTest(args: {
  queueId: string;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  await withSeedDb(async (db) => {
    const queue = await db.execute<{ user_id: string; status: string }>(
      sql`SELECT user_id, status FROM crp_validation_queue WHERE id = ${args.queueId}`,
    );
    const row = queue[0];
    if (!row) throw new Error(`rejectCrpFromTest: queue row ${args.queueId} not found`);
    if (row.status !== 'pending') {
      throw new Error(`rejectCrpFromTest: queue row ${args.queueId} is ${row.status}, not pending`);
    }
    await db.execute(sql`
      UPDATE crp_validation_queue
         SET status = 'rejected',
             decided_at = now(),
             decided_by = ${args.actorUserId},
             rejection_reason = ${args.reason}
       WHERE id = ${args.queueId}
    `);
    await db.execute(sql`
      UPDATE psychologist_profiles SET status = 'suspended' WHERE user_id = ${row.user_id}
    `);
  });
}

// Direct lifecycle helper for specs that explicitly want to bypass the
// callback (e.g. the happy-path e2e drives `email_verified` directly because
// the mock GoTrue does not implement PKCE token exchange).
export async function applyTransitionFromTest(
  userId: string,
  event:
    | 'email_verified'
    | 'crp_approved'
    | 'crp_rejected'
    | 'admin_suspend'
    | 'user_cancel'
    | 'admin_reinstate',
): Promise<void> {
  await withSeedDb(async (db) => {
    const rows = await db.execute<{ status: string }>(
      sql`SELECT status FROM psychologist_profiles WHERE user_id = ${userId}`,
    );
    const row = rows[0];
    if (!row) throw new Error(`applyTransitionFromTest: profile not found for ${userId}`);
    const next = nextStatus(row.status as SeedTarget, event);
    if (!next) {
      throw new Error(
        `applyTransitionFromTest: invalid (${row.status}, ${event}) — does not match the state machine`,
      );
    }
    await db.execute(
      sql`UPDATE psychologist_profiles SET status = ${next} WHERE user_id = ${userId}`,
    );
  });
}

function nextStatus(
  current: SeedTarget,
  event:
    | 'email_verified'
    | 'crp_approved'
    | 'crp_rejected'
    | 'admin_suspend'
    | 'user_cancel'
    | 'admin_reinstate',
): SeedTarget | null {
  if (current === 'pending_verification' && event === 'email_verified') {
    return 'pending_crp_validation';
  }
  if (current === 'pending_crp_validation' && event === 'crp_approved') return 'active';
  if (current === 'pending_crp_validation' && event === 'crp_rejected') return 'suspended';
  if (current === 'active' && event === 'admin_suspend') return 'suspended';
  if (current === 'active' && event === 'user_cancel') return 'cancelled';
  if (current === 'suspended' && event === 'admin_reinstate') return 'active';
  return null;
}

// Cleanup helper used by `afterEach`. Removes every artifact a spec may have
// created for a given user id. Idempotent — safe to call from afterEach
// blocks even when the test failed mid-setup.
export async function cleanupE2eUser(userId: string): Promise<void> {
  await withSeedDb(async (db) => {
    await db.execute(sql`DELETE FROM crp_validation_queue WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM psychologist_profiles WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${userId}`);
  });
  // Mock registry teardown is idempotent; tolerate failures so a teardown
  // hiccup does not mask the real test failure.
  try {
    await removeMockUser(userId);
  } catch {
    // best effort
  }
}

// Count `psychologist_profiles` rows by email. Used by the duplicate-email
// rejection spec to assert no orphan row was created when signup fails.
export async function countProfilesByEmail(email: string): Promise<number> {
  return withSeedDb(async (db) => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count
          FROM psychologist_profiles p
          JOIN auth.users u ON u.id = p.user_id
          WHERE u.email = ${email}`,
    );
    const first = rows[0];
    return first ? Number(first.count) : 0;
  });
}

// Count `psychologist_profiles` rows by (crp_number, crp_uf).
export async function countProfilesByCrp(crpNumber: string, crpUf: string): Promise<number> {
  return withSeedDb(async (db) => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count
          FROM psychologist_profiles
          WHERE crp_number = ${crpNumber} AND crp_uf = ${crpUf}`,
    );
    const first = rows[0];
    return first ? Number(first.count) : 0;
  });
}

// Count `auth.users` rows by email — orphan detection after compensating
// delete on signup rollback.
export async function countAuthUsersByEmail(email: string): Promise<number> {
  return withSeedDb(async (db) => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM auth.users WHERE email = ${email}`,
    );
    const first = rows[0];
    return first ? Number(first.count) : 0;
  });
}

// Look up an `auth.users` row by email and run `cleanupE2eUser` for every
// match. Used in test `finally` blocks where the test created a user via
// the form (mock GoTrue mints a fresh userId) and we don't have the
// id in scope. Idempotent — zero matches is a no-op.
export async function cleanupE2eUserByEmail(email: string): Promise<void> {
  const userIds = await withSeedDb(async (db) => {
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM auth.users WHERE email = ${email}`,
    );
    return rows.map((row) => row.id);
  });
  for (const id of userIds) {
    await cleanupE2eUser(id);
  }
}
