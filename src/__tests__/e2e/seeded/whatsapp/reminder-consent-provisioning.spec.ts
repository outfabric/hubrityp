import { test as base, expect, type Page } from '@playwright/test';
import pgModule from 'postgres';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { readSeedState, SEED_WHATSAPP_CONSENT_USER } from '../setup/seed-state';

/**
 * @whatsapp — Reminder settings LGPD-consent + lazy provisioning flow.
 *
 * Section 5.3: on the FIRST save (no shared-number WhatsApp account yet) the
 * form requires the LGPD consent checkbox; submitting with consent provisions
 * the account and shows the success toast. A SECOND access (after provisioning)
 * must NOT re-require consent — the checkbox is gone.
 *
 * Isolation: drives the dedicated `SEED_WHATSAPP_CONSENT_USER`, an active
 * psychologist touched by NOTHING else in the suite (see its rationale in
 * `seed-state.ts`). Signing in via `signInAsDedicatedUser` (NOT the shared
 * `storageState`, which is the global seed user whose whatsapp_accounts row is
 * DELETE/INSERTed by sibling specs under `fullyParallel`). `beforeEach` resets
 * the user to an account-free baseline so the flow is deterministic across
 * reruns on a reused Testcontainers Postgres.
 *
 * The save is a fire-and-forget Server Action inside `useTransition`: the action
 * reference binds only after the leaf hydrates, so we let the form settle and
 * arm `waitForResponse` on the `next-action` POST BEFORE clicking Salvar.
 */

const USER = SEED_WHATSAPP_CONSENT_USER;

async function openSql() {
  const seed = await readSeedState();
  return pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
}

/** Resets the dedicated user to an account-free, settings-free baseline. */
async function resetBaseline(): Promise<void> {
  const sql = await openSql();
  try {
    // FK order: templates -> settings -> accounts.
    await sql`DELETE FROM public.message_templates WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.reminder_settings WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.whatsapp_accounts WHERE user_id = ${USER.id}`;
  } finally {
    await sql.end();
  }
}

/** True once a shared-number WhatsApp account exists for the dedicated user. */
async function accountExists(): Promise<boolean> {
  const sql = await openSql();
  try {
    const rows = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM public.whatsapp_accounts WHERE user_id = ${USER.id};
    `;
    return (rows[0]?.n ?? 0) > 0;
  } finally {
    await sql.end();
  }
}

/** Clicks Salvar and waits for the save Server Action POST to round-trip. */
async function saveAndAwaitAction(page: Page): Promise<void> {
  // Let the leaf hydrate so the action reference binds before we fire it.
  await page.waitForTimeout(1_500);

  const actionResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.request().headers()['next-action'] !== undefined &&
      new URL(res.url()).pathname === '/configuracoes/lembretes' &&
      res.status() === 200,
    { timeout: 15_000 },
  );
  await page.getByTestId('reminder-settings-save').click();
  await actionResponse;
}

base.describe('@whatsapp reminder consent + provisioning', () => {
  // The flow provisions a whatsapp_accounts row; serial keeps the reset → assert
  // cycle deterministic across the two tests without a cross-worker lock.
  base.describe.configure({ mode: 'serial' });

  base.beforeEach(async ({ context, request }) => {
    await signInAsDedicatedUser(context, request, USER);
    await resetBaseline();
  });

  base(
    'first save requires consent, provisions the account, and shows the success toast',
    async ({ page }) => {
      const cacheBust = Date.now();
      await page.goto(`/configuracoes/lembretes?_=${cacheBust}`);

      await expect(page.getByTestId('reminder-settings-card')).toBeVisible({ timeout: 15_000 });

      // No account yet → the consent checkbox is present and required.
      const consent = page.getByTestId('reminder-consent-checkbox');
      await expect(consent).toBeVisible();

      // Consent copy covers both lawful bases.
      await expect(page.getByText(/número de WhatsApp da plataforma/i)).toBeVisible();
      await expect(page.getByText(/responsável por obter o consentimento/i)).toBeVisible();

      // Sanity: no account exists before the save.
      expect(await accountExists()).toBe(false);

      // Give consent, then save.
      await consent.click();
      await saveAndAwaitAction(page);

      await expect(page.getByText('Configurações de lembretes salvas')).toBeVisible({
        timeout: 10_000,
      });

      // The account was provisioned on this consented save.
      expect(await accountExists()).toBe(true);
    },
  );

  base('second access does not re-require consent after provisioning', async ({ page }) => {
    // First access: consent + save → provision.
    await page.goto(`/configuracoes/lembretes?_=${Date.now()}`);
    await expect(page.getByTestId('reminder-settings-card')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('reminder-consent-checkbox').click();
    await saveAndAwaitAction(page);
    await expect(page.getByText('Configurações de lembretes salvas')).toBeVisible({
      timeout: 10_000,
    });
    expect(await accountExists()).toBe(true);

    // Second access: the account now exists → consent must NOT be re-required.
    await page.goto(`/configuracoes/lembretes?_=${Date.now()}`);
    await expect(page.getByTestId('reminder-settings-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('reminder-consent-checkbox')).toHaveCount(0);

    // And a save still succeeds without any consent checkbox.
    await saveAndAwaitAction(page);
    await expect(page.getByText('Configurações de lembretes salvas')).toBeVisible({
      timeout: 10_000,
    });
  });
});
