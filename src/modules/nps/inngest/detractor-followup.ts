/**
 * Detractor follow-up email — Inngest function triggered by the
 * `nps/detractor.submitted` event.
 *
 * When a psychologist submits a detractor NPS score (0–6), `submitNpsImpl`
 * enqueues a fire-and-forget `nps/detractor.submitted` event carrying ONLY the
 * internal user id and the score (never the email, name, or free-text feedback).
 * This function:
 *   1. Validates the inbound payload at the boundary.
 *   2. Resolves the recipient address itself from the owner-scoped `profiles`
 *      row (the event never carries it — LGPD data minimization).
 *   3. Sends a generic follow-up email via the shared Resend helper. The body
 *      contains NO clinical content and NO NPS feedback.
 *
 * Service-role / RLS justification: this is a system Inngest job triggered by an
 * internal event. There is no user session in scope, so there is no
 * `auth.uid()` to scope by. The Drizzle `db` client bypasses RLS; ownership is
 * scoped via the TRUSTED event payload (`userId`), which originates from the
 * server-authoritative session inside `submitNpsImpl` — never from external or
 * client-supplied input. This function is reachable only through the Inngest
 * serve route (signed event delivery), never from a public, unauthenticated
 * request path.
 *
 * LGPD: log lines reference ONLY the internal user UUID. The recipient email,
 * name, and NPS feedback are never logged.
 */

import { sendNpsDetractorFollowupEmail } from '@/shared/lib/mail';

import { inngest } from './client';
import { detractorSubmittedEventSchema, NPS_EVENTS } from './events';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type DetractorFollowupOutcome = 'sent' | 'skipped_no_recipient' | 'send_failed';

export interface DetractorFollowupResult {
  outcome: DetractorFollowupOutcome;
}

// ---------------------------------------------------------------------------
// Dependencies — injected for testability
// ---------------------------------------------------------------------------

export interface DetractorFollowupDeps {
  /** Resolves the recipient email for a user id, or null when absent. */
  findRecipientEmail: (userId: string) => Promise<string | null>;
  /** Sends the detractor follow-up email. Returns ok=false on transport error. */
  sendEmail: (to: string) => Promise<{ ok: boolean }>;
  /** Structured logger that records ONLY the user id (no PII). */
  logInfo: (payload: { event: string; userId: string }) => void;
  logError: (payload: { event: string; userId: string }) => void;
}

// ---------------------------------------------------------------------------
// Core handler — exported for testability
// ---------------------------------------------------------------------------

/**
 * Resolves the recipient and sends the detractor follow-up email.
 *
 * The handler is a pure orchestration over its injected deps so the test can
 * drive every branch (no recipient, send failure, success) without a real
 * database or Resend connection.
 */
export async function handleDetractorFollowup(
  input: { userId: string },
  deps: DetractorFollowupDeps,
): Promise<DetractorFollowupResult> {
  const { userId } = input;

  const recipient = await deps.findRecipientEmail(userId);
  if (!recipient) {
    deps.logError({ event: 'nps_detractor_followup_no_recipient', userId });
    return { outcome: 'skipped_no_recipient' };
  }

  const sent = await deps.sendEmail(recipient);
  if (!sent.ok) {
    deps.logError({ event: 'nps_detractor_followup_send_failed', userId });
    return { outcome: 'send_failed' };
  }

  deps.logInfo({ event: 'nps_detractor_followup_sent', userId });
  return { outcome: 'sent' };
}

// ---------------------------------------------------------------------------
// Default dependency factories (production wiring)
// ---------------------------------------------------------------------------

async function defaultFindRecipientEmail(userId: string): Promise<string | null> {
  // Import lazily to keep this module edge-free (postgres-js pulls node:crypto)
  // and to avoid module-level side effects in tests.
  const { db } = await import('@/shared/db/client');
  const { eq } = await import('drizzle-orm');
  const { profiles } = await import('@/shared/db/schema/auth/tables');

  // Service-role: the Drizzle client bypasses RLS. Justified — system job, no
  // session in scope; ownership is the trusted event `userId` (see file header).
  const rows = await db
    .select({ email: profiles.email })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  return rows[0]?.email ?? null;
}

async function defaultSendEmail(to: string): Promise<{ ok: boolean }> {
  const result = await sendNpsDetractorFollowupEmail(to);
  return { ok: result.ok };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const npsDetractorFollowup = inngest.createFunction(
  {
    id: 'nps/detractor-followup',
    triggers: [{ event: NPS_EVENTS.DETRACTOR_SUBMITTED }],
  },
  async ({ event, step, logger }): Promise<DetractorFollowupResult> => {
    // Validate the inbound payload at the boundary.
    const data = detractorSubmittedEventSchema.parse(event.data);

    return step.run('send-detractor-followup', async () =>
      handleDetractorFollowup(
        { userId: data.userId },
        {
          findRecipientEmail: defaultFindRecipientEmail,
          sendEmail: defaultSendEmail,
          // LGPD: forward ONLY the user id to the logger.
          logInfo: (payload) => logger.info(payload),
          logError: (payload) => logger.error(payload),
        },
      ),
    );
  },
);
