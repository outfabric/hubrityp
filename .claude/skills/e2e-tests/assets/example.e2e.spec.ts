// E2E spec skeleton. Copy and adapt: journey, assertions and targeted mocks.
//
// Canonical location: src/__tests__/e2e/seeded/<domain>.spec.ts
// Domain tag (`@<domain>`) is MANDATORY — the dev-cycle orchestrator
// uses these tags to filter the suite with `--grep` for scoped re-validation.

import { test, expect } from '../fixtures/test-base';
import { createPaciente } from '../helpers/db';

test.describe('@agenda scheduling a consultation', () => {
  test('psychologist schedules a consultation, sees it on the agenda and triggers the reminder', async ({
    page,
    dr,
    twilioCalls,
  }) => {
    await createPaciente({ psicologoId: dr.id, nome: 'Maria Silva' });

    await page.goto('/agenda');
    await page.getByRole('button', { name: /nova consulta/i }).click();

    await page.getByRole('combobox', { name: /paciente/i }).click();
    await page.getByRole('option', { name: 'Maria Silva' }).click();
    await page.getByLabel(/data/i).fill('2026-06-01');
    await page.getByLabel(/horário/i).fill('14:00');

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/agendar') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: /confirmar/i }).click();
    const res = await responsePromise;
    expect(res.status()).toBe(200);

    await expect(page.getByText(/consulta agendada/i)).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Maria Silva' })
    ).toBeVisible();

    expect(twilioCalls.length).toBeGreaterThanOrEqual(1);
    expect(twilioCalls[0]).toContain('Maria');
  });

  test('shows an actionable error when the external integration fails', async ({
    page,
    dr,
    context,
  }) => {
    await createPaciente({ psicologoId: dr.id, nome: 'João Souza' });

    await context.route('https://api.twilio.com/**', (route) =>
      route.fulfill({ status: 503, body: 'Service Unavailable' })
    );

    await page.goto('/agenda');
    await page.getByRole('button', { name: /nova consulta/i }).click();
    await page.getByRole('combobox', { name: /paciente/i }).click();
    await page.getByRole('option', { name: 'João Souza' }).click();
    await page.getByLabel(/data/i).fill('2026-06-01');
    await page.getByLabel(/horário/i).fill('15:00');
    await page.getByRole('button', { name: /confirmar/i }).click();

    await expect(
      page.getByText(/consulta agendada/i)
    ).toBeVisible();
    await expect(
      page.getByText(/lembrete será reenviado/i)
    ).toBeVisible();
  });
});
