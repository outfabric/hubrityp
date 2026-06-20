import { expect, test } from '../setup/db-fixture';
import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Multi-phone child-registration regression E2E.
 *
 * Guards against the "55 corruption" bug where a `PhoneInput` (whose editable
 * value is the *national* portion `DD NNNNN-NNNN`, with the `+55` rendered as a
 * non-editable adornment) would leak the country code back into the typed,
 * visible value — yielding values like `55 11 98765-4321`.
 *
 * A `child` registration is the worst case because three independent
 * `PhoneInput` instances coexist on step 1:
 *   - the patient phone (`patient-form-phone`)
 *   - the WhatsApp reminder phone (`reminder-phone`)
 *   - the guardian phone (`guardian-0-phone`)
 *
 * The test types a distinct national number into each, asserts each field
 * independently displays exactly its national format (no injected `55`), then
 * submits and verifies the patient + guardian rows persisted in the canonical
 * stored formats:
 *   - `patients.phone`           → `+55 DD NNNNN-NNNN`
 *   - `patients.reminder_phone`  → E.164 `+55DDNNNNNNNNN`
 *   - `patient_guardians.phone`  → `+55 DD NNNNN-NNNN`
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - `db` fixture gives direct read access to the Testcontainers Postgres.
 */

test.describe('@patients child registration multi-phone input', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // National numbers typed into each of the three fields. Distinct DDDs/numbers
  // so a value leaking from one field into another would be detectable. The
  // DDDs/numbers are deliberately chosen to be unused by any other seeded spec
  // (e.g. the CSV-import fixture creates an "Ana Costa" patient with
  // `+55 11 98765-4321`), because the patient phone carries a UNIQUE constraint
  // and the seeded suite runs `fullyParallel` against a reused Postgres — a
  // shared number would race that constraint and reject this submit.
  const PATIENT_PHONE_NATIONAL = '27 99887-7665';
  const REMINDER_PHONE_NATIONAL = '28 99776-6554';
  const GUARDIAN_PHONE_NATIONAL = '47 99665-5443';

  // The raw digit strings a user actually types (no mask).
  const PATIENT_PHONE_DIGITS = '27998877665';
  const REMINDER_PHONE_DIGITS = '28997766554';
  const GUARDIAN_PHONE_DIGITS = '47996655443';

  // Canonical stored formats expected in the DB after submit.
  const PATIENT_PHONE_CANONICAL = '+55 27 99887-7665';
  const REMINDER_PHONE_E164 = '+5528997766554';
  const GUARDIAN_PHONE_CANONICAL = '+55 47 99665-5443';

  test('captures patient, reminder, and guardian phones without 55 corruption', async ({
    page,
    db,
  }) => {
    // Unique name to avoid collision with the reused Testcontainers DB.
    const uniqueSuffix = Date.now().toString().slice(-6);
    const fullName = `Lucas Multifone ${uniqueSuffix}`;

    await page.goto('/pacientes/novo');
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Identify the child patient.
    await page.getByTestId('patient-form-fullname').fill(fullName);
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Criança' }).click();

    // --- Patient phone -----------------------------------------------------
    const patientPhone = page.getByTestId('patient-form-phone');
    await patientPhone.fill(PATIENT_PHONE_DIGITS);
    // The editable input shows only the national portion — no `+55`, no `55`.
    await expect(patientPhone).toHaveValue(PATIENT_PHONE_NATIONAL);
    expect(await patientPhone.inputValue()).not.toMatch(/^55/);

    // --- Reminder phone (always visible, independent of opt-out) -----------
    const reminderPhone = page.getByTestId('reminder-phone');
    await reminderPhone.fill(REMINDER_PHONE_DIGITS);
    await expect(reminderPhone).toHaveValue(REMINDER_PHONE_NATIONAL);
    expect(await reminderPhone.inputValue()).not.toMatch(/^55/);

    // --- Guardian phone ----------------------------------------------------
    await expect(page.getByTestId('guardians-section')).toBeVisible();
    await page.getByTestId('add-guardian-btn').click();
    await expect(page.getByTestId('guardian-card-0')).toBeVisible();

    await page.getByTestId('guardian-0-fullname').fill('Ana Multifone');
    await page.getByTestId('guardian-0-relationship').fill('Mãe');

    const guardianPhone = page.getByTestId('guardian-0-phone');
    await guardianPhone.fill(GUARDIAN_PHONE_DIGITS);
    await expect(guardianPhone).toHaveValue(GUARDIAN_PHONE_NATIONAL);
    expect(await guardianPhone.inputValue()).not.toMatch(/^55/);

    // Each field must still hold its own value — no cross-contamination.
    await expect(patientPhone).toHaveValue(PATIENT_PHONE_NATIONAL);
    await expect(reminderPhone).toHaveValue(REMINDER_PHONE_NATIONAL);

    // --- Submit ------------------------------------------------------------
    await page.getByTestId('patient-form-next').click();
    await expect(page.getByTestId('patient-form-step2')).toBeVisible();
    await page.getByTestId('patient-form-skip').click();

    await page.waitForURL(/\/pacientes\/[a-f0-9-]+/, { timeout: 15000 });
    const idMatch = page.url().match(/\/pacientes\/([a-f0-9-]+)/);
    const patientId = idMatch?.[1];
    expect(patientId).toBeTruthy();
    if (!patientId) throw new Error('Could not extract patient id from URL');

    // --- Verify canonical persistence -------------------------------------
    const [patientRow] = await db.sql`
      SELECT phone, reminder_phone
      FROM public.patients
      WHERE id = ${patientId};
    `;
    expect(patientRow).toBeTruthy();
    expect(patientRow!.phone as string | null).toBe(PATIENT_PHONE_CANONICAL);
    expect(patientRow!.reminder_phone as string | null).toBe(REMINDER_PHONE_E164);

    const [guardianRow] = await db.sql`
      SELECT phone
      FROM public.patient_guardians
      WHERE patient_id = ${patientId};
    `;
    expect(guardianRow).toBeTruthy();
    expect(guardianRow!.phone as string | null).toBe(GUARDIAN_PHONE_CANONICAL);
  });
});
