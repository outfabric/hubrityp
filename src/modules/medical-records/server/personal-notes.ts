import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';

import {
  assessLockout,
  applyFailedAttempt,
  applySuccessfulVerification,
  type LockoutState,
} from '@/modules/medical-records/lib/personal-notes-lockout';
import {
  getPersonalNotesInputSchema,
  personalNotesPasswordSchema,
  upsertPersonalNotesInputSchema,
} from '@/modules/medical-records/lib/personal-notes-schemas';
import { db } from '@/shared/db/client';
import { auditLog, personalNotes } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Argon2id parameters (OWASP-recommended, node-argon2 defaults)
// ---------------------------------------------------------------------------

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetPersonalNotesResult =
  | {
      ok: true;
      content: string | null;
      hasPassword: boolean;
      isLocked: boolean;
      remainingAttempts?: number;
      lockedUntilIso?: string;
    }
  | {
      ok: false;
      code: 'LOCKED' | 'WRONG_PASSWORD' | 'UNAUTHORIZED';
      remainingAttempts?: number;
      lockedUntilIso?: string;
    };

export type UpsertPersonalNotesResult = { ok: true } | { ok: false; code: 'UNAUTHORIZED' };

export type SetPersonalNotesPasswordResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHORIZED' | 'WEAK_PASSWORD' };

export type RemovePersonalNotesPasswordResult =
  | { ok: true }
  | { ok: false; code: 'WRONG_PASSWORD' | 'LOCKED' | 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Internal: write audit log
// ---------------------------------------------------------------------------

async function writeAudit(
  userId: string,
  action: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId,
      action,
      resourceType: 'personal_notes',
      resourceId,
      metadata,
    });
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'personal_notes_audit_failed', errorCode: pgError.code },
      'failed to write audit_log for personal notes',
    );
  }
}

// ---------------------------------------------------------------------------
// Internal: verify patient ownership (defense-in-depth — db bypasses RLS)
// ---------------------------------------------------------------------------

async function verifyPatientOwnership(userId: string, patientId: string): Promise<boolean> {
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  return !!patient;
}

// ---------------------------------------------------------------------------
// getPersonalNotes
// ---------------------------------------------------------------------------

/**
 * Retrieves personal notes for a patient. If a password is set, the caller
 * must supply it for verification. Implements the lockout state machine.
 *
 * Flow:
 *   1. Authenticate via getUser().
 *   2. Validate input.
 *   3. Verify patient ownership.
 *   4. Fetch personal_notes row (may not exist yet).
 *   5. If no row or no password_hash: return content directly.
 *   6. If locked: reject without verifying hash.
 *   7. If password not supplied: return metadata (hasPassword/isLocked) without content.
 *   8. Verify password via argon2.
 *   9. On success: reset counter, write audit, return content.
 *  10. On failure: increment counter, maybe lock, write audit, return error.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getPersonalNotesImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetPersonalNotesResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = getPersonalNotesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const { patientId, password } = parsed.data;

  // 3. Verify patient ownership (defense-in-depth: db bypasses RLS)
  const ownsPatient = await verifyPatientOwnership(userId, patientId);
  if (!ownsPatient) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 4. Fetch personal_notes row
  const [note] = await db
    .select({
      id: personalNotes.id,
      content: personalNotes.content,
      passwordHash: personalNotes.passwordHash,
      failedAttempts: personalNotes.failedAttempts,
      lockedUntil: personalNotes.lockedUntil,
    })
    .from(personalNotes)
    .where(and(eq(personalNotes.patientId, patientId), eq(personalNotes.userId, userId)))
    .limit(1);

  // 5. No row or no password: return content directly
  if (!note || !note.passwordHash) {
    const resourceId = note?.id ?? null;

    await writeAudit(userId, 'personal-notes.read', resourceId, { patientId });

    return {
      ok: true,
      content: note?.content ?? null,
      hasPassword: false,
      isLocked: false,
    };
  }

  // 6. Assess lockout
  const lockoutState: LockoutState = {
    failedAttempts: note.failedAttempts,
    lockedUntil: note.lockedUntil,
  };

  const lockoutStatus = assessLockout(lockoutState);

  if (lockoutStatus.status === 'locked') {
    return {
      ok: false,
      code: 'LOCKED',
      lockedUntilIso: lockoutStatus.lockedUntilIso,
      remainingAttempts: 0,
    };
  }

  // 7. Password required but not supplied: return metadata without content
  if (!password) {
    return {
      ok: true,
      content: null,
      hasPassword: true,
      isLocked: false,
      remainingAttempts: Math.max(0, 5 - note.failedAttempts),
    };
  }

  // 8. Verify password
  let isValid: boolean;
  try {
    isValid = await argon2.verify(note.passwordHash, password);
  } catch {
    // Hash corruption or unexpected error — treat as failure
    isValid = false;
  }

  if (isValid) {
    // 9. Success: reset counter
    const resetState = applySuccessfulVerification();
    await db
      .update(personalNotes)
      .set({
        failedAttempts: resetState.failedAttempts,
        lockedUntil: resetState.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(personalNotes.id, note.id));

    await writeAudit(userId, 'personal-notes.read', note.id, { patientId });

    return {
      ok: true,
      content: note.content,
      hasPassword: true,
      isLocked: false,
    };
  }

  // 10. Failure: increment counter
  const failResult = applyFailedAttempt(lockoutState);

  await db
    .update(personalNotes)
    .set({
      failedAttempts: failResult.failedAttempts,
      lockedUntil: failResult.lockedUntil,
      updatedAt: new Date(),
    })
    .where(eq(personalNotes.id, note.id));

  await writeAudit(userId, 'personal-notes.password-failed', note.id, {
    patientId,
    failedAttempts: failResult.failedAttempts,
  });

  // Write separate lockout audit if just locked
  if (failResult.justLocked && failResult.lockedUntil) {
    await writeAudit(userId, 'personal-notes.locked', note.id, {
      patientId,
      lockedUntil: failResult.lockedUntil.toISOString(),
    });
  }

  return {
    ok: false,
    code: failResult.justLocked ? 'LOCKED' : 'WRONG_PASSWORD',
    remainingAttempts: failResult.remainingAttempts,
    lockedUntilIso: failResult.lockedUntil?.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// upsertPersonalNotes
// ---------------------------------------------------------------------------

/**
 * Creates or updates personal notes content for a patient. Uses upsert
 * (INSERT ON CONFLICT UPDATE) on the UNIQUE patient_id constraint.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function upsertPersonalNotesImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpsertPersonalNotesResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = upsertPersonalNotesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const { patientId, content } = parsed.data;

  // 3. Verify patient ownership (defense-in-depth)
  const ownsPatient = await verifyPatientOwnership(userId, patientId);
  if (!ownsPatient) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 4. Upsert (INSERT ON CONFLICT UPDATE)
  const [result] = await db
    .insert(personalNotes)
    .values({
      userId,
      patientId,
      content,
    })
    .onConflictDoUpdate({
      target: personalNotes.patientId,
      set: {
        content,
        updatedAt: new Date(),
      },
      // Safety: only update if the row belongs to this user
      setWhere: eq(personalNotes.userId, userId),
    })
    .returning({ id: personalNotes.id });

  // 5. Write audit log
  await writeAudit(userId, 'personal-notes.update', result?.id ?? null, { patientId });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// setPersonalNotesPassword
// ---------------------------------------------------------------------------

/**
 * Sets or updates the privacy password on a patient's personal notes.
 *
 * Hashes with argon2id (memoryCost=65536, timeCost=3, parallelism=4,
 * hashLength=32 — OWASP-recommended). Resets the failed_attempts counter
 * to prevent lockout from carrying over after a password change.
 *
 * INTENTIONAL: This action does NOT require the current password when
 * changing an existing password. The personal-notes password is a UX-level
 * privacy gate (e.g., shared workstation), not a cryptographic control.
 * The psychologist is already fully authenticated via Supabase Auth, so
 * they are the verified resource owner. Requiring the old password would
 * create a recovery deadlock (design.md Decision #1: no recovery mechanism).
 * This is consistent with the spec scenario "Set password on personal
 * notes" which only requires a new password. Note that
 * `removePersonalNotesPassword` DOES require the current password because
 * removal lowers the privacy bar, whereas changing to a new password
 * maintains it.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function setPersonalNotesPasswordImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<SetPersonalNotesPasswordResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const schema = getPersonalNotesInputSchema.extend({
    newPassword: personalNotesPasswordSchema,
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // Check if the failure is specifically about password strength
    const passwordIssues = parsed.error.issues.filter((i) => i.path.includes('newPassword'));
    if (passwordIssues.length > 0) {
      return { ok: false, code: 'WEAK_PASSWORD' };
    }
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const { patientId, newPassword } = parsed.data;

  // 3. Verify patient ownership (defense-in-depth)
  const ownsPatient = await verifyPatientOwnership(userId, patientId);
  if (!ownsPatient) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 4. Hash password with argon2id
  const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);

  // 5. Upsert personal_notes row with new password hash, resetting lockout state
  const [result] = await db
    .insert(personalNotes)
    .values({
      userId,
      patientId,
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
    })
    .onConflictDoUpdate({
      target: personalNotes.patientId,
      set: {
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      },
      setWhere: eq(personalNotes.userId, userId),
    })
    .returning({ id: personalNotes.id });

  // 6. Write audit log
  await writeAudit(userId, 'personal-notes.password-set', result?.id ?? null, { patientId });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// removePersonalNotesPassword
// ---------------------------------------------------------------------------

/**
 * Removes the privacy password from personal notes. Requires the current
 * password for verification (prevents an unattended browser from removing
 * the gate). On failure, the lockout state machine applies normally.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function removePersonalNotesPasswordImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<RemovePersonalNotesPasswordResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const schema = getPersonalNotesInputSchema.extend({
    currentPassword: personalNotesPasswordSchema,
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const { patientId, currentPassword } = parsed.data;

  // 3. Verify patient ownership (defense-in-depth)
  const ownsPatient = await verifyPatientOwnership(userId, patientId);
  if (!ownsPatient) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 4. Fetch personal_notes row
  const [note] = await db
    .select({
      id: personalNotes.id,
      passwordHash: personalNotes.passwordHash,
      failedAttempts: personalNotes.failedAttempts,
      lockedUntil: personalNotes.lockedUntil,
    })
    .from(personalNotes)
    .where(and(eq(personalNotes.patientId, patientId), eq(personalNotes.userId, userId)))
    .limit(1);

  if (!note || !note.passwordHash) {
    // No notes or no password to remove — treat as not found
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 5. Assess lockout
  const lockoutState: LockoutState = {
    failedAttempts: note.failedAttempts,
    lockedUntil: note.lockedUntil,
  };

  const lockoutStatus = assessLockout(lockoutState);

  if (lockoutStatus.status === 'locked') {
    return { ok: false, code: 'LOCKED' };
  }

  // 6. Verify current password
  let isValid: boolean;
  try {
    isValid = await argon2.verify(note.passwordHash, currentPassword);
  } catch {
    isValid = false;
  }

  if (!isValid) {
    // Failed attempt — apply lockout state machine
    const failResult = applyFailedAttempt(lockoutState);

    await db
      .update(personalNotes)
      .set({
        failedAttempts: failResult.failedAttempts,
        lockedUntil: failResult.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(personalNotes.id, note.id));

    await writeAudit(userId, 'personal-notes.password-failed', note.id, {
      patientId,
      failedAttempts: failResult.failedAttempts,
    });

    if (failResult.justLocked && failResult.lockedUntil) {
      await writeAudit(userId, 'personal-notes.locked', note.id, {
        patientId,
        lockedUntil: failResult.lockedUntil.toISOString(),
      });
    }

    return {
      ok: false,
      code: failResult.justLocked ? 'LOCKED' : 'WRONG_PASSWORD',
    };
  }

  // 7. Password verified — remove it and reset lockout state
  await db
    .update(personalNotes)
    .set({
      passwordHash: null,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(personalNotes.id, note.id));

  await writeAudit(userId, 'personal-notes.password-removed', note.id, { patientId });

  return { ok: true };
}
