import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { stampFirstAccess } from '@/modules/dashboard';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// first_access_at moved to the wizard entry (tasks 5.9 + 5.10).
//
// Behavioral half: the wizard's first authenticated render stamps
// `first_access_at = now()` when NULL; a subsequent render does NOT overwrite
// the original instant (idempotent `IS NULL` guard). We exercise the SAME helper
// the wizard render fires (`stampFirstAccess`) against real Postgres.
//
// Structural half: the dashboard page no longer stamps, and the wizard pages do
// — asserted against the page source so a regression that re-adds the dashboard
// stamp (or drops it from the wizard) fails here, in parity with the spec
// "Dashboard no longer stamps first_access_at".
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  const meta = JSON.stringify({
    fullName: 'Test Psychologist',
    crpNumber: userId.slice(0, 6),
    crpUf: 'SP',
    termsAcceptedAt: '2026-01-01T00:00:00Z',
    privacyAcceptedAt: '2026-01-01T00:00:00Z',
    sensitiveDataConsentAt: '2026-01-01T00:00:00Z',
  });
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`},
                   '{"provider":"email"}'::jsonb, ${meta}::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function readFirstAccessAt(userId: string): Promise<Date | null> {
  const rows = await runAsService(async (db) =>
    db.execute(dsql`SELECT first_access_at FROM profiles WHERE user_id = ${userId}`),
  );
  const value = (rows[0] as { first_access_at: string | null } | undefined)?.first_access_at;
  return value ? new Date(value) : null;
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof stampFirstAccess>[0];
}

// Repo root: this spec lives at src/__tests__/integration/onboarding/, so four
// levels up reaches the worktree root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

describe('first_access_at stamped at the wizard entry', () => {
  it('stamps on the first wizard render (was NULL) and is idempotent on the next', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    expect(await readFirstAccessAt(userId)).toBeNull();

    // First wizard render fires the same helper the welcome/setup pages call.
    const first = await stampFirstAccess(fakeSupabaseClient(userId));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.stamped).toBe(true);

    const firstStampedAt = await readFirstAccessAt(userId);
    expect(firstStampedAt).toBeInstanceOf(Date);

    // A subsequent render must NOT overwrite the original instant.
    const second = await stampFirstAccess(fakeSupabaseClient(userId));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.stamped).toBe(false);
    expect((await readFirstAccessAt(userId))?.getTime()).toBe(firstStampedAt?.getTime());
  });

  it('the dashboard page no longer calls stampFirstAccess', async () => {
    const source = await readFile(join(REPO_ROOT, 'src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(source).not.toContain('stampFirstAccess');
  });

  it('the wizard welcome page stamps first_access_at', async () => {
    const source = await readFile(
      join(REPO_ROOT, 'src/app/(app)/onboarding/welcome/page.tsx'),
      'utf8',
    );
    expect(source).toContain('stampFirstAccess');
  });

  it('the wizard setup page stamps first_access_at (defensive second entry)', async () => {
    const source = await readFile(
      join(REPO_ROOT, 'src/app/(app)/onboarding/setup/[step]/page.tsx'),
      'utf8',
    );
    expect(source).toContain('stampFirstAccess');
  });
});
