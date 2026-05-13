import { toZonedTime } from 'date-fns-tz';

import { test, expect } from '../setup/db-fixture';
import { SEED_PATIENTS, SEED_SESSIONS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @whatsapp -- Confirmation flow E2E test.
 *
 * Verifies that a session confirmed via WhatsApp shows as "Confirmada" in the UI.
 *
 * Because the E2E environment does not run Inngest or a real Twilio webhook
 * endpoint (TWILIO_AUTH_TOKEN / TWILIO_WEBHOOK_URL are not set), we simulate
 * the confirmation by directly updating the session status in the DB — this is
 * the exact same state mutation the webhook-confirmation-handler Inngest
 * function performs. The integration tests cover the webhook endpoint and
 * Inngest handler in isolation.
 *
 * Flow:
 *   1. Seed a scheduled session (use SEED_SESSIONS.confirmable)
 *   2. Simulate webhook confirmation by setting status='confirmed', confirmed_at=now()
 *   3. Read the session's start_at from the DB and compute its BRT date
 *   4. Navigate to the agenda in day view on the session's BRT date
 *   5. Click the session chip to open the detail drawer
 *   6. Verify the status badge shows "Confirmada" (success variant)
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 *   - Seeded session (SEED_SESSIONS.confirmable) exists.
 */

test.describe('@whatsapp confirmation flow', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    // Reset the confirmable session to 'scheduled' state before each test
    await db.resetSession(SEED_SESSIONS.confirmable.id, { status: 'scheduled' });
  });

  test('session shows as Confirmada after simulated webhook confirmation', async ({ page, db }) => {
    // Simulate the confirmation that the Inngest webhook-confirmation-handler
    // would perform: set status to 'confirmed' and confirmed_at to now()
    await db.sql`
      UPDATE public.sessions
      SET status       = 'confirmed',
          confirmed_at = now(),
          updated_at   = now()
      WHERE id = ${SEED_SESSIONS.confirmable.id};
    `;

    // Read the session's actual start_at from the DB to compute the correct
    // BRT calendar date. The seed uses `now() + interval '2 days'` which is
    // relative to Postgres' clock at seed time — computing this in JS from
    // the test runner's clock is fragile near midnight BRT boundaries.
    const rows = await db.sql`
      SELECT start_at FROM public.sessions WHERE id = ${SEED_SESSIONS.confirmable.id};
    `;
    const row = rows[0];
    expect(row, 'confirmable session must exist in DB').toBeDefined();
    const sessionStartBrt = toZonedTime(new Date(row!.start_at as string), 'America/Sao_Paulo');
    const sessionDay = String(sessionStartBrt.getDate());

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Switch to day view and navigate to the session's BRT date.
    // The session is ~2 days from now. Navigate forward from today until
    // the period title shows the correct day number.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();

    // Navigate forward until the period title contains the session's day.
    // Cap at 5 clicks to avoid an infinite loop if the date is unreachable.
    for (let i = 0; i < 5; i++) {
      const title = await page.getByTestId('agenda-period-title').textContent();
      if (title && new RegExp(`\\b${sessionDay}\\b`).test(title)) break;
      await page.getByTestId('agenda-nav-next').click();
    }

    // Wait for the period title to confirm we're on the correct day
    await expect(page.getByTestId('agenda-period-title')).toContainText(
      new RegExp(`\\b${sessionDay}\\b`),
      { timeout: 10000 },
    );

    // The confirmable session is for SEED_PATIENTS.activeWithPhone (Maria Silva).
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;

    // Find a chip with the patient name and the "Confirmada" badge
    const confirmedChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('session-status-badge-confirmed') });
    await expect(confirmedChip).toBeVisible({ timeout: 15000 });

    // Click the chip to open the detail drawer
    await confirmedChip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge in the drawer shows "Confirmada"
    await expect(drawer.getByTestId('session-status-badge-confirmed')).toBeVisible();
  });
});
