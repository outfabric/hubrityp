import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

import type { AuthRealCredentials } from './credentials';
import { CREDENTIALS_FILE_NAME, SEED_EMAIL, SEED_PASSWORD } from './credentials';

// The auth-real suite seeds a single user via the Supabase Admin API and
// hands the credentials to the test through a JSON fixture file written
// under `src/__tests__/e2e/real/setup/.auth/`. We deliberately use a file
// (not env vars) because Playwright workers run in separate processes and
// any env state set here would not survive the boundary.
//
// Idempotency: if a user with `SEED_EMAIL` already exists from a prior run
// (e.g. CI retried, or developer ran the suite twice), we delete it first
// so the fresh `createUser` call always succeeds.
//
// `playwright.real.config.ts` validates that the Supabase stack is running
// and exports the discovered URL + service-role key on
// `process.env.AUTH_REAL_*` BEFORE this hook fires. We re-read those values
// here instead of shelling out a second time.
//
// Metadata + status flip: the `auth-account-creation` change introduced a
// SECURITY DEFINER trigger `public.handle_new_user()` on `auth.users` that
// raises an exception when any of the consent / CRP fields below is missing
// from `raw_user_meta_data`. Without the metadata payload the entire
// `admin.createUser` call rolls back. Mirrors the seeded-suite payload at
// `src/__tests__/e2e/seeded/setup/global-setup.ts:43-63`.
//
// The trigger initialises `profiles.status = 'pending_verification'`, which
// causes `middleware.ts` to redirect any `/dashboard` request to
// `/onboarding/pending`. Since `auth.spec.ts` asserts the dashboard URL
// after sign-in, we forcibly UPDATE the profile to `active` afterwards —
// the seeded suite uses the same shortcut at
// `src/__tests__/e2e/seeded/setup/global-setup.ts:69-76`.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, '.auth', CREDENTIALS_FILE_NAME);

export default async function globalSetup(): Promise<void> {
  const supabaseUrl = process.env.AUTH_REAL_SUPABASE_URL;
  const serviceRoleKey = process.env.AUTH_REAL_SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.AUTH_REAL_DATABASE_URL;

  if (!supabaseUrl || !serviceRoleKey || !databaseUrl) {
    throw new Error(
      '[auth-real/global-setup] Missing AUTH_REAL_SUPABASE_URL, ' +
        'AUTH_REAL_SUPABASE_SERVICE_ROLE_KEY, or AUTH_REAL_DATABASE_URL. The ' +
        'config file is responsible for populating these — did you bypass ' +
        '`playwright.real.config.ts`?',
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Drop any pre-existing user with the seed email. `listUsers` paginates
  //    by default; the test only ever creates one row, so the first page is
  //    enough — if a future change starts seeding many users this query
  //    needs to be revisited.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    throw new Error(`[auth-real/global-setup] listUsers failed: ${listErr.message}`);
  }
  const existing = list.users.find((u) => u.email === SEED_EMAIL);
  if (existing) {
    const { error: delErr } = await admin.auth.admin.deleteUser(existing.id);
    if (delErr) {
      throw new Error(
        `[auth-real/global-setup] deleteUser(${existing.id}) failed: ${delErr.message}`,
      );
    }
  }

  // 2. Create the fresh user. `email_confirm: true` short-circuits the email
  //    verification step that would otherwise block sign-in — local-only
  //    confirm because production never seeds users this way.
  //
  //    `user_metadata` carries the keys the `handle_new_user()` trigger
  //    requires to materialize the corresponding `profiles` row; missing any
  //    of them aborts the entire `admin.createUser` transaction.
  const nowIso = new Date().toISOString();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: {
      fullName: 'Seed Real User',
      crpNumber: '06/000001',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    },
  });
  if (createErr || !created.user) {
    throw new Error(
      `[auth-real/global-setup] createUser failed: ${createErr?.message ?? 'no user returned'}`,
    );
  }

  // 3. Flip the materialized profile from `pending_verification` to `active`
  //    so middleware lets `/dashboard` render directly. Without this UPDATE
  //    the existing `auth.spec.ts` assertion on `**/dashboard` would time
  //    out (middleware rewrites to `/onboarding/pending`). Idempotent: safe
  //    to run on already-active rows.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now())
      WHERE user_id = ${created.user.id};
    `;
  } finally {
    await sql.end();
  }

  // 4. Persist credentials to disk so the test (a separate worker process)
  //    can pick them up. Worker env vars don't survive the process boundary
  //    so a JSON file is the simplest reliable channel.
  const credentials: AuthRealCredentials = {
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    userId: created.user.id,
  };
  await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, JSON.stringify(credentials, null, 2), 'utf8');
}
