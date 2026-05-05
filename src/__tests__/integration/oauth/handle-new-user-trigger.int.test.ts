import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';

// Tests for the rewritten `handle_new_user()` trigger that branches by
// `raw_app_meta_data ->> 'provider'`:
//   - provider='email' or NULL → INSERT into profiles (email signup path)
//   - any other provider (e.g., 'google') → RETURN NEW without inserting
//
// The trigger fires on INSERT into `auth.users`. We use the service-role
// connection (which bypasses RLS) to simulate Supabase Auth inserting rows.

const validMeta = {
  fullName: 'Maria Silva',
  crpNumber: '06/000001',
  crpUf: 'SP',
  termsAcceptedAt: '2024-01-01T00:00:00Z',
  privacyAcceptedAt: '2024-01-01T00:00:00Z',
  sensitiveDataConsentAt: '2024-01-01T00:00:00Z',
};

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

describe('handle_new_user() trigger — provider branching (integration)', () => {
  it('INSERT with provider=email creates a profile row', async () => {
    const userId = randomUUID();
    const email = `${randomUUID().replace(/-/g, '')}@test.local`;

    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
             VALUES (${userId}, ${email}, ${JSON.stringify(validMeta)}::jsonb, '{"provider":"email"}'::jsonb)`,
      );
    });

    const rows = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(email);
    expect(rows[0]!.fullName).toBe('Maria Silva');
    expect(rows[0]!.crpNumber).toBe('06/000001');
    expect(rows[0]!.crpUf).toBe('SP');
    expect(rows[0]!.status).toBe('pending_verification');
  });

  it('INSERT with provider=NULL (absent) treats as email — creates profile', async () => {
    const userId = randomUUID();
    const email = `${randomUUID().replace(/-/g, '')}@test.local`;

    await runAsService(async (db) => {
      // raw_app_meta_data is the default empty JSON (no 'provider' key at all)
      await db.execute(
        dsql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
             VALUES (${userId}, ${email}, ${JSON.stringify(validMeta)}::jsonb, '{}'::jsonb)`,
      );
    });

    const rows = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(email);
    expect(rows[0]!.fullName).toBe('Maria Silva');
  });

  it('INSERT with provider=google does NOT create a profile row', async () => {
    const userId = randomUUID();
    const email = `${randomUUID().replace(/-/g, '')}@test.local`;

    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
             VALUES (${userId}, ${email}, '{}'::jsonb, '{"provider":"google"}'::jsonb)`,
      );
    });

    const rows = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, userId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('INSERT with any non-email provider (e.g., github) does NOT create a profile', async () => {
    const userId = randomUUID();
    const email = `${randomUUID().replace(/-/g, '')}@test.local`;

    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
             VALUES (${userId}, ${email}, '{}'::jsonb, '{"provider":"github"}'::jsonb)`,
      );
    });

    const rows = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, userId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('email signup with missing metadata still raises exception (no regression)', async () => {
    const userId = randomUUID();
    const email = `${randomUUID().replace(/-/g, '')}@test.local`;

    // Missing fullName — trigger should raise
    const incompleteMeta = {
      crpNumber: '06/000002',
      crpUf: 'SP',
      termsAcceptedAt: '2024-01-01T00:00:00Z',
      privacyAcceptedAt: '2024-01-01T00:00:00Z',
      sensitiveDataConsentAt: '2024-01-01T00:00:00Z',
    };

    // postgres-js may wrap the trigger error in different formats across
    // versions; the behavioural contract is: the INSERT raises and the
    // transaction rolls back (no partial user row remains).
    let caught: unknown = null;
    try {
      await runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
               VALUES (${userId}, ${email}, ${JSON.stringify(incompleteMeta)}::jsonb, '{"provider":"email"}'::jsonb)`,
        );
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);

    // Verify the row was not persisted (transaction rolled back)
    const rows = await runAsService(async (db) =>
      db.execute(dsql`SELECT id FROM auth.users WHERE id = ${userId}`),
    );
    expect(rows).toHaveLength(0);
  });
});
