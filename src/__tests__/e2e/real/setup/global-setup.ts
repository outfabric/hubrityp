import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, '.auth', CREDENTIALS_FILE_NAME);

export default async function globalSetup(): Promise<void> {
  const supabaseUrl = process.env.AUTH_REAL_SUPABASE_URL;
  const serviceRoleKey = process.env.AUTH_REAL_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      '[auth-real/global-setup] Missing AUTH_REAL_SUPABASE_URL or ' +
        'AUTH_REAL_SUPABASE_SERVICE_ROLE_KEY. The config file is responsible ' +
        'for populating these — did you bypass `playwright.real.config.ts`?',
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
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(
      `[auth-real/global-setup] createUser failed: ${createErr?.message ?? 'no user returned'}`,
    );
  }

  // 3. Persist credentials to disk so the test (a separate worker process)
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
