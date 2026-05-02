// Esqueleto de spec E2E. Copie e adapte: jornada, asserções e mocks pontuais.

import { test, expect } from '../fixtures/test-base';
import { createPaciente } from '../helpers/db';

test.describe('Agendamento de consulta', () => {
  test('psicólogo agenda consulta, vê na agenda e dispara lembrete', async ({
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

  test('mostra erro acionável quando integração externa falha', async ({
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
