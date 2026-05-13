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
 *   3. Navigate to the agenda in day view on the session's date
 *   4. Click the session chip to open the detail drawer
 *   5. Verify the status badge shows "Confirmada" (success variant)
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

  test('session shows as Confirmada after simulated webhook confirmation', async ({
    page,
    db,
  }) => {
    // Simulate the confirmation that the Inngest webhook-confirmation-handler
    // would perform: set status to 'confirmed' and confirmed_at to now()
    await db.sql`
      UPDATE public.sessions
      SET status       = 'confirmed',
          confirmed_at = now(),
          updated_at   = now()
      WHERE id = ${SEED_SESSIONS.confirmable.id};
    `;

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // The confirmable session is seeded at "now() + 2 days". Navigate to
    // find the day that contains it. Since it's 2 days from now, we need
    // to navigate forward from today.
    // Switch to day view
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    // Go forward 2 days
    await page.getByTestId('agenda-nav-next').click();
    await page.getByTestId('agenda-nav-next').click();

    // Wait for the calendar to update and look for the confirmed session chip.
    // The confirmable session is for SEED_PATIENTS.activeWithPhone (Maria Silva).
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;

    // Look for a chip with the patient name and the "Confirmada" badge
    const confirmedChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('session-status-badge-confirmed') });
    await expect(confirmedChip).toBeVisible({ timeout: 15000 });

    // Click the chip to open the detail drawer.
    // Use force:true because FullCalendar's fc-event-main overlay intercepts
    // pointer events on the inner chip element, causing a timeout otherwise.
    await confirmedChip.click({ force: true });

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge in the drawer shows "Confirmada"
    await expect(drawer.getByTestId('session-status-badge-confirmed')).toBeVisible();
  });
});
