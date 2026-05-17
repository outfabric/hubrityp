# Mocking network with `page.route()`

In E2E the **database is real** but external integrations (Twilio, Asaas, Receita Saúde, Gemini) are intercepted — a real call is slow, costs money and produces flakiness in CI.

## Basic `page.route()`

Intercepts before the request leaves the context:

```ts
await page.route('https://api.twilio.com/**/Messages.json', async (route) => {
  const body = await route.request().postData();
  twilioCalls.push(body);
  await route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ sid: 'SM_test', status: 'queued' }),
  });
});
```

Applies to calls made **by the browser**. If the integration runs on the server (Server Action calls Twilio), `page.route()` **does not intercept** — you need to intercept in the server fixture (env var pointing to a mock server) or via MSW if the app reads a configurable URL.

## Pattern: default mocks in the fixture

Centralize "always on" mocks in `test-base`:

```ts
// src/__tests__/e2e/seeded/fixtures/test-base.ts
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ twilioCalls: string[] }>({
  twilioCalls: [
    async ({ context }, use) => {
      const calls: string[] = [];
      await context.route('https://api.twilio.com/**', async (route) => {
        calls.push((await route.request().postData()) ?? '');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ sid: 'SM_test' }),
        });
      });
      await context.route('https://api.asaas.com/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'pay_test', status: 'PENDING' }),
        });
      });
      await use(calls);
    },
    { auto: true }, // turns on the mock in every test, even if not declared
  ],
});

export { expect };
```

`{ auto: true }` forces the fixture to run even when the test does not mention `twilioCalls` — perfect for defensive mocks.

## Verify requests without fulfilling

If you want to **observe** without altering (rare in E2E):

```ts
const requests: string[] = [];
page.on('request', (req) => {
  if (req.url().includes('/api/agendamentos')) requests.push(req.url());
});
```

Generally, prefer `waitForResponse` for targeted assertions:

```ts
const res = await page.waitForResponse(
  (r) => r.url().endsWith('/api/agendamentos') && r.request().method() === 'POST'
);
expect(res.status()).toBe(201);
expect(await res.json()).toMatchObject({ ok: true });
```

## Errors and bad scenarios

```ts
// Twilio responds 503 → app must show fallback
await page.route('https://api.twilio.com/**', (route) =>
  route.fulfill({ status: 503, body: 'Service Unavailable' })
);

// Asaas responds slowly (test loading state)
await page.route('https://api.asaas.com/**', async (route) => {
  await new Promise((r) => setTimeout(r, 2000));
  await route.fulfill({ status: 200, body: '{"id":"pay_x"}' });
});
```

Error scenarios are where E2E earns its value over integration — you see the **toast**, the **UI state**, the **message the user reads**.

## Incoming webhooks

Webhooks (Twilio confirms delivery, Asaas confirms payment) arrive at the app's Route Handler, coming from the internet. In E2E, **fire them manually** via the `request` API (Playwright's HTTP client):

```ts
test('billing turns "paid" when the Asaas webhook arrives', async ({ page, request }) => {
  // ... create billing via UI ...

  await request.post(`${page.url().split('/agenda')[0]}/api/webhooks/asaas`, {
    headers: { 'asaas-access-token': process.env.ASAAS_WEBHOOK_TOKEN! },
    data: { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_test' } },
  });

  await page.reload();
  await expect(page.getByRole('row', { name: /pago/i })).toBeVisible();
});
```

## Server-side integrations (Resend, Gemini, Receita Saúde)

`page.route()` **does not see** calls made by Next.js on the server. Strategies:

1. **Env var pointing to a mock**: the app reads `RESEND_BASE_URL` (or similar) which in test points to `http://localhost:3101`. Spin up a small mock server on that port in the `start-server.ts` wrapper (same pattern as `mock-gotrue.ts`).
2. **`vi.mock` at the app module level does not work in E2E** — Playwright has no hook at that level.
3. **Mock provider via DI in the app**: if the app accepts injection of the external client (e.g., `getResendClient()` reads env and returns real or stub), force the stub in `NODE_ENV=test`.
4. **Ignore** if the integration is purely lateral and the test can assert the visible effect (e.g., app marks `email_enviado: true` in the DB — just check that).

Option 3 is the cleanest when the app already has that abstraction; otherwise, option 4 covers 80% of cases.

## Checklist

- [ ] Every external browser call intercepted in the fixture (auto: true).
- [ ] No test depends on real Twilio/Asaas (search for `https://api.` in specs).
- [ ] Error scenarios (503, timeout) covered for critical flows.
- [ ] Incoming webhooks fired via `request.post` inside the test itself.
