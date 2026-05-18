import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPersonalNotesImpl,
  upsertPersonalNotesImpl,
  setPersonalNotesPasswordImpl,
  removePersonalNotesPasswordImpl,
} from '@/modules/medical-records/server/personal-notes';
import { auditLog, personalNotes } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
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
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      status: 'active',
    });
  });
}

/**
 * Creates a fake SupabaseClient with stubbed auth.
 * Personal notes do not use Storage, so no storage stubs needed.
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof getPersonalNotesImpl>[0];
}

async function getAuditEntries(userId: string, action: string) {
  return runAsService(async (db) => {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.action, action)));
  });
}

async function getPersonalNotesRow(patientId: string) {
  return runAsService(async (db) => {
    const [row] = await db
      .select()
      .from(personalNotes)
      .where(eq(personalNotes.patientId, patientId))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Directly set failed_attempts and locked_until on a personal_notes row
 * to simulate lockout state without going through 5 password attempts.
 */
async function setLockoutState(
  patientId: string,
  failedAttempts: number,
  lockedUntil: Date | null,
): Promise<void> {
  await runAsService(async (db) => {
    await db
      .update(personalNotes)
      .set({ failedAttempts, lockedUntil })
      .where(eq(personalNotes.patientId, patientId));
  });
}

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// upsertPersonalNotes — auto-save (no password)
// =====================================================================

describe('upsertPersonalNotesImpl', () => {
  it('creates a personal_notes row on first upsert', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    const result = await upsertPersonalNotesImpl(supabase, {
      patientId,
      content: '<p>First note</p>',
    });

    expect(result).toEqual({ ok: true });

    const row = await getPersonalNotesRow(patientId);
    expect(row).not.toBeNull();
    expect(row!.content).toBe('<p>First note</p>');
    expect(row!.userId).toBe(userId);
  });

  it('updates content on subsequent upsert (INSERT ON CONFLICT)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'v1' });
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'v2' });

    const row = await getPersonalNotesRow(patientId);
    expect(row!.content).toBe('v2');
  });

  it('writes audit_log with action personal-notes.update', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'audited' });

    const entries = await getAuditEntries(userId, 'personal-notes.update');
    expect(entries.length).toBe(1);
    expect(entries[0]!.resourceType).toBe('personal_notes');
  });

  it('rejects unauthenticated user', async () => {
    const supabase = fakeSupabaseClient(null);
    const result = await upsertPersonalNotesImpl(supabase, {
      patientId: randomUUID(),
      content: 'hack',
    });
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });
});

// =====================================================================
// getPersonalNotes — without password
// =====================================================================

describe('getPersonalNotesImpl (no password)', () => {
  it('returns content directly when no password is set', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: '<p>Hello</p>' });

    const result = await getPersonalNotesImpl(supabase, { patientId });
    expect(result).toMatchObject({
      ok: true,
      content: '<p>Hello</p>',
      hasPassword: false,
      isLocked: false,
    });
  });

  it('returns null content when no notes exist yet', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    const result = await getPersonalNotesImpl(supabase, { patientId });
    expect(result).toMatchObject({
      ok: true,
      content: null,
      hasPassword: false,
    });
  });
});

// =====================================================================
// Password flow: set, verify, wrong, lockout
// =====================================================================

describe('getPersonalNotesImpl (with password)', () => {
  it('wrong password increments failed_attempts', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'secret' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'correct-password' });

    const result = await getPersonalNotesImpl(supabase, {
      patientId,
      password: 'wrong-password',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('WRONG_PASSWORD');
      expect(result.remainingAttempts).toBe(4);
    }

    const row = await getPersonalNotesRow(patientId);
    expect(row!.failedAttempts).toBe(1);
  });

  it('correct password returns content and resets counter', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'unlocked-content' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'my-password' });

    // Cause some failed attempts first
    await getPersonalNotesImpl(supabase, { patientId, password: 'wrong' });
    await getPersonalNotesImpl(supabase, { patientId, password: 'wrong' });

    const row = await getPersonalNotesRow(patientId);
    expect(row!.failedAttempts).toBe(2);

    // Now correct password
    const result = await getPersonalNotesImpl(supabase, { patientId, password: 'my-password' });
    expect(result).toMatchObject({
      ok: true,
      content: 'unlocked-content',
      hasPassword: true,
      isLocked: false,
    });

    const updatedRow = await getPersonalNotesRow(patientId);
    expect(updatedRow!.failedAttempts).toBe(0);
    expect(updatedRow!.lockedUntil).toBeNull();
  });

  it('5 wrong passwords trigger lockout', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'protected' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'my-pass-123' });

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const r = await getPersonalNotesImpl(supabase, { patientId, password: 'wrong' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('WRONG_PASSWORD');
      }
    }

    // 5th attempt triggers lockout
    const lockResult = await getPersonalNotesImpl(supabase, { patientId, password: 'wrong' });
    expect(lockResult.ok).toBe(false);
    if (!lockResult.ok) {
      expect(lockResult.code).toBe('LOCKED');
      expect(lockResult.lockedUntilIso).toBeDefined();
    }

    const row = await getPersonalNotesRow(patientId);
    expect(row!.failedAttempts).toBe(5);
    expect(row!.lockedUntil).not.toBeNull();
  });

  it('during lockout, correct password is still rejected', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'locked-content' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'the-password' });

    // Simulate lockout via direct DB update (faster than 5 attempts)
    await setLockoutState(patientId, 5, new Date(Date.now() + 15 * 60 * 1000));

    const result = await getPersonalNotesImpl(supabase, {
      patientId,
      password: 'the-password',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LOCKED');
    }
  });

  it('after lockout window expires, correct password succeeds and resets counter', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'after-lockout' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'valid-pass' });

    // Set lockout in the past (already expired)
    await setLockoutState(patientId, 5, new Date(Date.now() - 60_000));

    const result = await getPersonalNotesImpl(supabase, {
      patientId,
      password: 'valid-pass',
    });

    expect(result).toMatchObject({
      ok: true,
      content: 'after-lockout',
      hasPassword: true,
    });

    const row = await getPersonalNotesRow(patientId);
    expect(row!.failedAttempts).toBe(0);
    expect(row!.lockedUntil).toBeNull();
  });

  it('returns hasPassword=true and content=null when password is set but not supplied', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'hidden' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'secret' });

    const result = await getPersonalNotesImpl(supabase, { patientId });
    expect(result).toMatchObject({
      ok: true,
      content: null,
      hasPassword: true,
      isLocked: false,
    });
  });
});

// =====================================================================
// setPersonalNotesPassword
// =====================================================================

describe('setPersonalNotesPasswordImpl', () => {
  it('sets password and resets failed_attempts', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'test' });

    // Simulate some failed attempts
    await setLockoutState(patientId, 3, null);

    const result = await setPersonalNotesPasswordImpl(supabase, {
      patientId,
      newPassword: 'new-pass-123',
    });

    expect(result).toEqual({ ok: true });

    const row = await getPersonalNotesRow(patientId);
    expect(row!.passwordHash).toBeDefined();
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row!.failedAttempts).toBe(0);
    expect(row!.lockedUntil).toBeNull();
  });

  it('writes audit_log with action personal-notes.password-set', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'audit-pass' });

    const entries = await getAuditEntries(userId, 'personal-notes.password-set');
    expect(entries.length).toBe(1);
  });

  it('rejects password shorter than 6 characters with WEAK_PASSWORD', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    const result = await setPersonalNotesPasswordImpl(supabase, {
      patientId,
      newPassword: '12345',
    });

    expect(result).toEqual({ ok: false, code: 'WEAK_PASSWORD' });
  });
});

// =====================================================================
// removePersonalNotesPassword
// =====================================================================

describe('removePersonalNotesPasswordImpl', () => {
  it('removes password with correct current password', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'remove-test' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'remove-me' });

    const result = await removePersonalNotesPasswordImpl(supabase, {
      patientId,
      currentPassword: 'remove-me',
    });

    expect(result).toEqual({ ok: true });

    const row = await getPersonalNotesRow(patientId);
    expect(row!.passwordHash).toBeNull();
    expect(row!.failedAttempts).toBe(0);
    expect(row!.lockedUntil).toBeNull();
  });

  it('writes audit_log with action personal-notes.password-removed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'test' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'pass-123' });
    await removePersonalNotesPasswordImpl(supabase, { patientId, currentPassword: 'pass-123' });

    const entries = await getAuditEntries(userId, 'personal-notes.password-removed');
    expect(entries.length).toBe(1);
  });

  it('rejects with WRONG_PASSWORD on incorrect current password', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'test' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'correct-pw' });

    const result = await removePersonalNotesPasswordImpl(supabase, {
      patientId,
      currentPassword: 'wrong-pw-123',
    });

    expect(result).toEqual({ ok: false, code: 'WRONG_PASSWORD' });
  });

  it('rejects with LOCKED during lockout', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'test' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'my-pass-here' });

    // Simulate lockout
    await setLockoutState(patientId, 5, new Date(Date.now() + 15 * 60 * 1000));

    const result = await removePersonalNotesPasswordImpl(supabase, {
      patientId,
      currentPassword: 'my-pass-here',
    });

    expect(result).toEqual({ ok: false, code: 'LOCKED' });
  });

  it('wrong password on remove increments failed_attempts (can trigger lockout)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'test' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'my-pw-1234' });

    // Set 4 failed attempts already
    await setLockoutState(patientId, 4, null);

    const result = await removePersonalNotesPasswordImpl(supabase, {
      patientId,
      currentPassword: 'wrong-pw-aaa',
    });

    expect(result).toEqual({ ok: false, code: 'LOCKED' });

    const row = await getPersonalNotesRow(patientId);
    expect(row!.failedAttempts).toBe(5);
    expect(row!.lockedUntil).not.toBeNull();
  });
});

// =====================================================================
// RLS negative: psychologist B blocked from A's notes
// =====================================================================

describe('RLS isolation', () => {
  it('psychologist B cannot access notes of psychologist A patient', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    const supabaseA = fakeSupabaseClient(userA);
    await upsertPersonalNotesImpl(supabaseA, { patientId, content: 'private-A' });

    // User B tries to read User A's patient notes
    const supabaseB = fakeSupabaseClient(userB);
    const result = await getPersonalNotesImpl(supabaseB, { patientId });

    // Should fail — patient ownership check blocks it
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('psychologist B cannot upsert notes for A patient', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    const supabaseB = fakeSupabaseClient(userB);
    const result = await upsertPersonalNotesImpl(supabaseB, {
      patientId,
      content: 'injected',
    });

    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });
});

// =====================================================================
// Audit log entries for all actions
// =====================================================================

describe('audit log completeness', () => {
  it('records audit entries for read, update, password-set, password-failed, and password-removed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);

    // 1. Update (upsert)
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'audit-flow' });

    // 2. Read (no password)
    await getPersonalNotesImpl(supabase, { patientId });

    // 3. Password-set
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'audit-pw' });

    // 4. Password-failed (wrong password)
    await getPersonalNotesImpl(supabase, { patientId, password: 'wrong' });

    // 5. Successful read
    await getPersonalNotesImpl(supabase, { patientId, password: 'audit-pw' });

    // 6. Password-removed
    await removePersonalNotesPasswordImpl(supabase, { patientId, currentPassword: 'audit-pw' });

    // Verify all audit actions exist
    const actions = [
      'personal-notes.update',
      'personal-notes.read',
      'personal-notes.password-set',
      'personal-notes.password-failed',
      'personal-notes.password-removed',
    ];

    for (const action of actions) {
      const entries = await getAuditEntries(userId, action);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('records personal-notes.locked audit on lockout trigger', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);
    await upsertPersonalNotesImpl(supabase, { patientId, content: 'lock-audit' });
    await setPersonalNotesPasswordImpl(supabase, { patientId, newPassword: 'lock-pw-1' });

    // Trigger lockout with 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      await getPersonalNotesImpl(supabase, { patientId, password: 'wrong' });
    }

    const lockedEntries = await getAuditEntries(userId, 'personal-notes.locked');
    expect(lockedEntries.length).toBe(1);

    // Verify metadata includes lockedUntil
    const metadata = lockedEntries[0]!.metadata as Record<string, unknown>;
    expect(metadata.lockedUntil).toBeDefined();
    expect(typeof metadata.lockedUntil).toBe('string');
  });
});
