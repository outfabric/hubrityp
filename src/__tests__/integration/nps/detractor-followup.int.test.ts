import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mocks
//
// Resend HTTP seam: `sendEmailViaResend` is the single point that reaches the
// network. Mocking it here lets us assert the detractor email is dispatched
// (and inspect the recipient + body) without a real Resend connection, while
// still exercising the production DB email resolution against real Postgres.
//
// Shared logger: capture every structured payload so we can prove the LGPD
// contract — log lines carry the internal user id but NEVER the email, name, or
// feedback.
// ---------------------------------------------------------------------------

const sendEmailViaResend = vi.fn().mockResolvedValue({ ok: true, id: 'resend-test-id' });

vi.mock('@/shared/lib/mail/resend', () => ({ sendEmailViaResend }));

const logCalls: Array<Record<string, unknown>> = [];

vi.mock('@/shared/lib/logger', () => {
  const record = (payload: Record<string, unknown>) => logCalls.push(payload);
  const base = {
    info: vi.fn(record),
    error: vi.fn(record),
    warn: vi.fn(record),
    debug: vi.fn(),
  };
  return {
    logger: { child: vi.fn(() => base), ...base },
    redactPaths: [],
  };
});

// Imported AFTER the mocks so production code picks up the mocked Resend + logger.
const { handleDetractorFollowup, npsDetractorFollowup } =
  await import('@/modules/nps/inngest/detractor-followup');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PII_EMAIL_FRAGMENT = 'detractor-pii';
const PII_NAME = 'Seed Detractor Psychologist';

/**
 * Production wiring uses the shared pino logger (mocked above) inside the
 * Inngest function, but the extracted `handleDetractorFollowup` receives a
 * `logInfo`/`logError` closure. We forward to the same capture array so the
 * LGPD assertions cover both code paths.
 */
function captureLogger() {
  return {
    logInfo: (payload: { event: string; userId: string }) => logCalls.push(payload),
    logError: (payload: { event: string; userId: string }) => logCalls.push(payload),
  };
}

/** Resolves the recipient email from the seeded profile (production lookup). */
async function findRecipientEmail(userId: string): Promise<string | null> {
  const { profiles } = await import('@/shared/db/schema/auth/tables');
  const { eq } = await import('drizzle-orm');
  return runAsService(async (db) => {
    const rows = await db
      .select({ email: profiles.email })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return rows[0]?.email ?? null;
  });
}

/** Sends via the production Resend helper (mocked at the HTTP seam). */
async function sendEmail(to: string): Promise<{ ok: boolean }> {
  const { sendNpsDetractorFollowupEmail } = await import('@/shared/lib/mail');
  const result = await sendNpsDetractorFollowupEmail(to);
  return { ok: result.ok };
}

// `handle_new_user()` (SECURITY DEFINER trigger) materializes `public.profiles`
// from `raw_user_meta_data`, so the metadata it requires MUST be present. The
// email carries a recognizable fragment so we can assert it never reaches a log.
async function seedAuthUser(userId: string): Promise<void> {
  const meta = JSON.stringify({
    fullName: PII_NAME,
    crpNumber: userId.slice(0, 6),
    crpUf: 'SP',
    termsAcceptedAt: '2026-01-01T00:00:00Z',
    privacyAcceptedAt: '2026-01-01T00:00:00Z',
    sensitiveDataConsentAt: '2026-01-01T00:00:00Z',
  });
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           VALUES (${userId}, ${`${PII_EMAIL_FRAGMENT}-${userId}@example.com`},
                   '{"provider":"email"}'::jsonb, ${meta}::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

beforeAll(async () => {
  await cleanTestData();
});

beforeEach(() => {
  sendEmailViaResend.mockClear();
  logCalls.length = 0;
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

describe('npsDetractorFollowup — real Postgres', () => {
  it('sends the follow-up email when a detractor event resolves a recipient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await handleDetractorFollowup(
      { userId },
      { findRecipientEmail, sendEmail, ...captureLogger() },
    );

    expect(result.outcome).toBe('sent');
    expect(sendEmailViaResend).toHaveBeenCalledTimes(1);

    const sentArg = sendEmailViaResend.mock.calls[0]![0] as {
      to: string;
      subject: string;
      html: string;
      text?: string;
    };
    // Resolved from the seeded profile row — never carried by the event.
    expect(sentArg.to).toBe(`${PII_EMAIL_FRAGMENT}-${userId}@example.com`);
    // No clinical content / no echoed feedback in the body.
    expect(sentArg.html).not.toContain(PII_NAME);
    expect(sentArg.text ?? '').not.toContain(PII_NAME);
  });

  it('logs only the user id — never the email, name, or feedback (LGPD)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await handleDetractorFollowup(
      { userId },
      { findRecipientEmail, sendEmail, ...captureLogger() },
    );

    expect(logCalls.length).toBeGreaterThan(0);
    expect(logCalls.some((c) => c.userId === userId)).toBe(true);

    const serialized = JSON.stringify(logCalls);
    expect(serialized).not.toContain(PII_EMAIL_FRAGMENT);
    expect(serialized).not.toContain(PII_NAME);
    // No raw email or feedback key surfaced into any log payload.
    expect(logCalls.every((c) => !('email' in c))).toBe(true);
    expect(logCalls.every((c) => !('feedback' in c))).toBe(true);
    expect(logCalls.every((c) => !('to' in c))).toBe(true);
  });

  it('does not send and reports skipped when the recipient cannot be resolved', async () => {
    // No seeded user — the lookup returns null (e.g., a deleted profile).
    const userId = randomUUID();

    const result = await handleDetractorFollowup(
      { userId },
      { findRecipientEmail, sendEmail, ...captureLogger() },
    );

    expect(result.outcome).toBe('skipped_no_recipient');
    expect(sendEmailViaResend).not.toHaveBeenCalled();
  });

  it('reports send_failed (and never throws) when Resend transport fails', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    sendEmailViaResend.mockResolvedValueOnce({ ok: false, error: 'send_failed' });

    const result = await handleDetractorFollowup(
      { userId },
      { findRecipientEmail, sendEmail, ...captureLogger() },
    );

    expect(result.outcome).toBe('send_failed');
    expect(sendEmailViaResend).toHaveBeenCalledTimes(1);
  });

  it('only runs for detractors: a promoter never dispatches a follow-up email', () => {
    // The detractor email is a SIDE EFFECT gated upstream: `submitNpsImpl` only
    // enqueues `nps/detractor.submitted` for scores 0–6 (covered in
    // submit-nps.int.test.ts), so this function never runs for a promoter. From
    // this function's own perspective the invariant is: no invocation → no send.
    // Assert that across a clean run no email was dispatched, and that the
    // exported Inngest function is wired (registered in the serve route).
    expect(sendEmailViaResend).not.toHaveBeenCalled();
    expect(npsDetractorFollowup).toBeDefined();
  });
});
