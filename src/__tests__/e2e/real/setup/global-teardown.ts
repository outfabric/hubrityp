import { execSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import type { AuthRealCredentials } from './credentials';
import { CREDENTIALS_FILE_NAME } from './credentials';

// Best-effort teardown for the auth-real suite.
//
// We delete the seeded user via the admin API and remove the local fixture
// file. ALL errors are swallowed: this hook runs even when the test failed,
// and a hard throw here would mask the real failure in Playwright's report.
// The next run is also idempotent (`globalSetup` deletes any pre-existing
// user with the same email), so a stale row would not break a retry.
//
// Stack lifecycle: if `playwright.real.config.ts` booted Supabase on-demand
// it sets `AUTH_REAL_STARTED_BY_TEST=1`, and we mirror that with a `stop` here.
// If the developer started the stack themselves (flag absent), we leave it
// running so their unrelated dev session is not nuked underneath them.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, '.auth', CREDENTIALS_FILE_NAME);

export default async function globalTeardown(): Promise<void> {
  const supabaseUrl = process.env.AUTH_REAL_SUPABASE_URL;
  const serviceRoleKey = process.env.AUTH_REAL_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // Config never loaded — nothing to clean up. No-op.
    return;
  }

  let credentials: AuthRealCredentials | null = null;
  try {
    const raw = await readFile(FIXTURE_PATH, 'utf8');
    credentials = JSON.parse(raw) as AuthRealCredentials;
  } catch {
    // Fixture absent — globalSetup never wrote it (likely because supabase
    // wasn't ready). Nothing to delete.
    return;
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(credentials.userId);
  } catch {
    // Swallow — see comment at top of file.
  }

  try {
    await rm(FIXTURE_PATH, { force: true });
  } catch {
    // Swallow — the file is gitignored anyway.
  }

  if (process.env.AUTH_REAL_STARTED_BY_TEST === '1') {
    try {
      execSync('npx supabase stop', { stdio: 'inherit' });
    } catch {
      // Swallow — see comment at top of file.
    }
  }
}
