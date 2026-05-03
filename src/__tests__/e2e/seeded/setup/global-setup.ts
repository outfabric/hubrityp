import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';
import { healthPings } from '@/shared/db/schema/health/tables';

import { readSeedState } from './seed-state';

// Playwright runs `globalSetup` AFTER the `webServer` plugin starts (see
// Playwright's `runner/tasks.ts::createGlobalSetupTasks`), so by the time
// we get here the wrapper at `src/__tests__/e2e/seeded/setup/start-server.ts`
// has already:
//
//   • booted the Testcontainers Postgres,
//   • applied Drizzle migrations,
//   • started the mock GoTrue,
//   • written `src/__tests__/e2e/seeded/setup/.auth/seed-state.json`,
//   • spawned `next start` with the resolved env vars.
//
// All this hook does is seed the user + ping rows + ACTIVE psychologist
// profile that the auth and health flows rely on. We keep this seeding here
// (rather than in start-server) so failures during seeding surface in
// Playwright's globalSetup logs and the run aborts cleanly instead of
// leaving the webServer dangling on a half-seeded DB.
//
// Section 7 of `add-account-signup-and-lifecycle` adds status-aware
// middleware: an authenticated user with no profile (or a non-`active`
// status) is bounced away from `/dashboard` to `/login?reason=...` or to a
// bloqueante page. The default seed identity must therefore carry an
// `active` profile so the long-standing `auth.spec.ts` dashboard render
// test continues to pass. Specs that need to exercise other statuses
// (verify-email, crp-review, suspended) update this row and MUST restore it
// to `active` in their `afterEach` so cross-file races against the dashboard
// test stay benign — see `auth-verify-callback.spec.ts` and
// `middleware-routing.spec.ts` for the pattern.
export default async function globalSetup() {
  const seed = await readSeedState();

  const sql = postgres(seed.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    // `auth.users` is bootstrapped by the postgres-container helper — the
    // schema already exists. We seed the deterministic UUID + email the
    // mock GoTrue echoes back from `GET /auth/v1/user`. `ON CONFLICT`
    // keeps the seed idempotent across reused containers.
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email)
      VALUES (
        ${seed.userId},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${seed.email}
      )
      ON CONFLICT (id) DO NOTHING;
    `;

    await db
      .insert(healthPings)
      .values({ ownerId: seed.userId, note: 'e2e-seed ping' })
      .onConflictDoNothing();

    // Seed an `active` psychologist profile for the seed user. The default
    // status the middleware sees on `/dashboard` for the seed user is
    // therefore `active`, which keeps the dashboard render path open.
    //
    // CRP number is stable + tagged `e2e-seed` so the (crp_number, crp_uf)
    // UNIQUE constraint can never collide with random factory values used
    // by other test files (those use 6-digit numerics).
    const now = new Date();
    await db
      .insert(psychologistProfiles)
      .values({
        userId: seed.userId,
        fullName: 'Seed User',
        crpNumber: 'e2e-seed-000001',
        crpUf: 'SP',
        status: 'active',
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        sensitiveDataConsentAt: now,
        termsVersion: '2026-05',
        privacyVersion: '2026-05',
        sensitiveDataConsentVersion: '2026-05',
      })
      .onConflictDoNothing();
  } finally {
    await sql.end();
  }
}
