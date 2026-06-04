import { test as base, expect } from '@playwright/test';
import pgModule from 'postgres';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { readSeedState, SEED_ONBOARDING_CHECKLIST_USER } from '../setup/seed-state';

/**
 * @onboarding -- First-run checklist (section 4.1).
 *
 * Drives the dedicated `SEED_ONBOARDING_CHECKLIST_USER` (an active psychologist
 * owning NO data, so its mandatory checklist starts at exactly one item done —
 * `cadastro_completo`) through the contractual behaviours from
 * `onboarding-checklist/spec.md`:
 *
 *   - the card is visible while a mandatory item is pending, with each item in
 *     the correct done / pending visual state;
 *   - the recompute reflects newly created data: inserting an owner-scoped
 *     patient row flips `primeiro_paciente` from pending to done on the next
 *     render (the server re-derives every item from source tables, never trusts
 *     a stale flag);
 *   - reaching mandatory 100% (with the AI bonus still pending) shows the
 *     completion celebration and collapses the card by default;
 *   - the checklist stays reachable under Configurações → Ajuda → Primeiros
 *     passos, rendered read-only once complete.
 *
 * Isolation: this user is touched by NOTHING else in the suite, so the spec owns
 * its state end-to-end and can run `fullyParallel` without an advisory lock. All
 * mutations are owner-scoped inserts against the Testcontainers Postgres; we
 * reset the owned rows + the persisted checklist cache in `beforeEach` so the
 * reused container starts each test from the clean "only cadastro_completo"
 * baseline `global-setup.ts` establishes.
 *
 * We do NOT use `test.use({ storageState })` (that cookie is the global seed
 * user); instead each test signs in as the dedicated user via the shared helper.
 */

const USER = SEED_ONBOARDING_CHECKLIST_USER;

// Reserved UUIDs for the rows this spec creates. Owner-scoped to USER; cleaned
// in beforeEach so every test sees the same baseline regardless of order/retry.
const LOCATION_ID = '00000000-0000-4000-8000-0000000000c5';
const PATIENT_ID = '00000000-0000-4000-8000-0000000000c6';
const SESSION_ID = '00000000-0000-4000-8000-0000000000c7';
const EVOLUTION_ID = '00000000-0000-4000-8000-0000000000c8';

async function openSql() {
  const seed = await readSeedState();
  return pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
}

/**
 * Resets the dedicated user to the clean "only cadastro_completo done" baseline:
 * drops every owned source row this spec might have created plus the persisted
 * `onboarding_checklist` cache. Idempotent across retries and reused containers.
 */
async function resetChecklistUser(): Promise<void> {
  const sql = await openSql();
  try {
    await sql`DELETE FROM public.evolutions WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.session_history WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.consent_terms WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.locations WHERE user_id = ${USER.id}`;
    await sql`DELETE FROM public.onboarding_checklist WHERE user_id = ${USER.id}`;
  } finally {
    await sql.end();
  }
}

/** Inserts one active patient owned by the user (flips `primeiro_paciente`). */
async function insertActivePatient(withConsent = false): Promise<void> {
  const sql = await openSql();
  try {
    await sql`
      INSERT INTO public.patients (
        id, user_id, full_name, patient_type, status, consent_signed_at
      )
      VALUES (
        ${PATIENT_ID}, ${USER.id}, 'Paciente Checklist', 'individual', 'active',
        ${withConsent ? sql`now()` : null}
      )
      ON CONFLICT (id) DO UPDATE SET
        status            = 'active',
        consent_signed_at = ${withConsent ? sql`now()` : null},
        archived_at       = NULL;
    `;
  } finally {
    await sql.end();
  }
}

/** Brings the user to mandatory 100% by inserting every mandatory item's data. */
async function completeAllMandatory(): Promise<void> {
  const sql = await openSql();
  try {
    // perfil_e_local → one location.
    await sql`
      INSERT INTO public.locations (id, user_id, name, type)
      VALUES (${LOCATION_ID}, ${USER.id}, 'Consultório Checklist', 'in_person')
      ON CONFLICT (id) DO NOTHING;
    `;
    // primeiro_paciente + primeiro_termo → one active patient with consent.
    await sql`
      INSERT INTO public.patients (
        id, user_id, full_name, patient_type, status, consent_signed_at
      )
      VALUES (
        ${PATIENT_ID}, ${USER.id}, 'Paciente Checklist', 'individual', 'active', now()
      )
      ON CONFLICT (id) DO UPDATE SET
        status            = 'active',
        consent_signed_at = now(),
        archived_at       = NULL;
    `;
    // primeira_sessao → one non-cancelled session.
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking
      )
      VALUES (
        ${SESSION_ID}, ${USER.id}, ${PATIENT_ID},
        (now() + interval '1 day'),
        (now() + interval '1 day' + interval '50 minutes'),
        50, 'scheduled', 'online', false
      )
      ON CONFLICT (id) DO UPDATE SET status = 'scheduled', deleted_at = NULL;
    `;
    // primeira_evolucao → one evolution.
    await sql`
      INSERT INTO public.evolutions (
        id, user_id, patient_id, session_id, template_type, content
      )
      VALUES (
        ${EVOLUTION_ID}, ${USER.id}, ${PATIENT_ID}, ${SESSION_ID},
        'livre', ${'{"text":"Primeira evolução"}'}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
  } finally {
    await sql.end();
  }
}

base.describe('@onboarding checklist — first-run progress', () => {
  // Every test in this block mutates the SAME dedicated user's data rows (insert
  // patient/session/location to flip checklist items). The seeded suite runs
  // `fullyParallel`, so without serialization one test's `completeAllMandatory`
  // would race another's `resetChecklistUser`, leaving the user in a state
  // neither test expects. Serial mode (plus the per-test reset below) keeps each
  // test deterministic without needing a cross-worker advisory lock — these
  // tests all run on the same worker.
  base.describe.configure({ mode: 'serial' });

  base.beforeEach(async ({ context, request }) => {
    await resetChecklistUser();
    await signInAsDedicatedUser(context, request, USER);
  });

  base(
    'renders the card with cadastro done and every other mandatory item pending',
    async ({ page }) => {
      await page.goto('/dashboard');

      const card = page.getByTestId('onboarding-checklist-card');
      await expect(card).toBeVisible();

      // Baseline: only `cadastro_completo` is done; the five other mandatory items
      // and the AI bonus are pending. Assert the done-state via the row's
      // `data-done` contract (set by the card from the server-derived state).
      await expect(page.getByTestId('onboarding-checklist-item-cadastro_completo')).toHaveAttribute(
        'data-done',
        'true',
      );
      for (const key of [
        'perfil_e_local',
        'primeiro_paciente',
        'primeira_sessao',
        'primeira_evolucao',
        'primeiro_termo',
        'transcricao_ia',
      ]) {
        await expect(page.getByTestId(`onboarding-checklist-item-${key}`)).toHaveAttribute(
          'data-done',
          'false',
        );
      }

      // 1 of 6 mandatory done → ~17%. The celebration is absent while pending.
      await expect(page.getByTestId('onboarding-checklist-progress')).toHaveText('17% concluído');
      await expect(page.getByTestId('onboarding-checklist-celebration')).toHaveCount(0);

      // The pending patient item exposes a CTA pointing at its fixed action target.
      const patientCta = page.getByTestId('onboarding-checklist-action-primeiro_paciente');
      await expect(patientCta).toBeVisible();
      await expect(patientCta).toHaveAttribute('href', '/pacientes');
    },
  );

  base('recompute reflects a newly created patient (pending → done)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('onboarding-checklist-item-primeiro_paciente')).toHaveAttribute(
      'data-done',
      'false',
    );

    // Create an owner-scoped patient out of band (as a CRUD action would), then
    // reload: the server recompute re-derives the item from the source table.
    await insertActivePatient();
    await page.reload();

    await expect(page.getByTestId('onboarding-checklist-item-primeiro_paciente')).toHaveAttribute(
      'data-done',
      'true',
    );
    // The done item drops its "Concluir" CTA.
    await expect(page.getByTestId('onboarding-checklist-action-primeiro_paciente')).toHaveCount(0);
    // The card is still present — other mandatory items remain pending.
    await expect(page.getByTestId('onboarding-checklist-card')).toBeVisible();
  });

  base(
    'reaching mandatory 100% shows the celebration and collapses the card on Ajuda',
    async ({ page }) => {
      await completeAllMandatory();

      // On the dashboard, the card hides once mandatory is complete
      // (`hideWhenComplete`), so the permanent home of the now-complete checklist
      // is Configurações → Ajuda → Primeiros passos. Assert there.
      await page.goto('/configuracoes/ajuda/primeiros-passos');

      const card = page.getByTestId('onboarding-checklist-card');
      await expect(card).toBeVisible();

      // 100% mandatory progress (the AI bonus is excluded from the math, so it
      // stays pending without lowering the percentage).
      await expect(page.getByTestId('onboarding-checklist-progress')).toHaveText('100% concluído');

      // The celebration appears on completion.
      const celebration = page.getByTestId('onboarding-checklist-celebration');
      await expect(celebration).toBeVisible();
      await expect(celebration).toContainText('Você completou a configuração inicial');

      // The card collapses by default at 100%: the item list is removed from the
      // DOM (Radix Collapsible) until the user expands it via the header trigger.
      await expect(page.getByTestId('onboarding-checklist-item-cadastro_completo')).toHaveCount(0);

      // Expanding the card reveals every mandatory item as done and the AI bonus
      // still pending (data-done="false") — proving 100% was reached WITHOUT the
      // bonus.
      await page.getByTestId('onboarding-checklist-trigger').click();
      for (const key of [
        'cadastro_completo',
        'perfil_e_local',
        'primeiro_paciente',
        'primeira_sessao',
        'primeira_evolucao',
        'primeiro_termo',
      ]) {
        await expect(page.getByTestId(`onboarding-checklist-item-${key}`)).toHaveAttribute(
          'data-done',
          'true',
        );
      }
      await expect(page.getByTestId('onboarding-checklist-item-transcricao_ia')).toHaveAttribute(
        'data-done',
        'false',
      );

      // Read-only once complete: the still-pending bonus item exposes no CTA
      // (the read-only mount suppresses every action button).
      await expect(page.getByTestId('onboarding-checklist-action-transcricao_ia')).toHaveCount(0);
    },
  );

  base('the checklist is reachable from Configurações → Ajuda', async ({ page }) => {
    // Navigate the way a user would: the settings index card "Ajuda".
    await page.goto('/configuracoes');
    await expect(page.getByTestId('settings-index-page')).toBeVisible({ timeout: 10_000 });

    const ajudaCard = page.getByTestId('settings-area-card-ajuda');
    await expect(ajudaCard).toBeVisible();
    await expect(ajudaCard).toContainText('Ajuda');
    await ajudaCard.click();

    await page.waitForURL('**/configuracoes/ajuda/primeiros-passos', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/ajuda/primeiros-passos');

    // The permanent checklist home renders the card (still part-done in the
    // baseline, so the items are visible without expanding).
    await expect(page.getByTestId('settings-primeiros-passos-page')).toBeVisible();
    await expect(page.getByTestId('onboarding-checklist-card')).toBeVisible();
  });
});
