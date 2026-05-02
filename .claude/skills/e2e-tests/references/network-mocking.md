# Mockando rede com `page.route()`

Em E2E o **banco é real** mas integrações externas (Twilio, Asaas, Receita Saúde, Gemini) são interceptadas — chamada real é lenta, custa dinheiro e gera flakiness no CI.

## `page.route()` básico

Intercepta antes da requisição sair do contexto:

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

Aplica-se a chamadas feitas **pelo navegador**. Se a integração roda no servidor (Server Action chama Twilio), o `page.route()` **não intercepta** — você precisa interceptar no fixture do servidor (env var pointing para mock server) ou via MSW se o app lê uma URL configurável.

## Padrão: mocks padrão no fixture

Centralize mocks "sempre ligados" no `test-base`:

```ts
// e2e/fixtures/test-base.ts
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
    { auto: true }, // ativa o mock em todo teste, mesmo se não declarado
  ],
});

export { expect };
```

`{ auto: true }` força o fixture a rodar mesmo quando o teste não menciona `twilioCalls` — perfeito para mocks defensivos.

## Verificar requests sem fulfilar

Se você quer **observar** sem alterar (raro em E2E):

```ts
const requests: string[] = [];
page.on('request', (req) => {
  if (req.url().includes('/api/agendamentos')) requests.push(req.url());
});
```

Em geral, prefira `waitForResponse` para asserções pontuais:

```ts
const res = await page.waitForResponse(
  (r) => r.url().endsWith('/api/agendamentos') && r.request().method() === 'POST'
);
expect(res.status()).toBe(201);
expect(await res.json()).toMatchObject({ ok: true });
```

## Erros e cenários ruins

```ts
// Twilio responde 503 → app deve mostrar fallback
await page.route('https://api.twilio.com/**', (route) =>
  route.fulfill({ status: 503, body: 'Service Unavailable' })
);

// Asaas responde lento (testar loading state)
await page.route('https://api.asaas.com/**', async (route) => {
  await new Promise((r) => setTimeout(r, 2000));
  await route.fulfill({ status: 200, body: '{"id":"pay_x"}' });
});
```

Cenários de erro são onde E2E ganha valor sobre integração — você vê o **toast**, o **estado da UI**, a **mensagem que o usuário lê**.

## Webhooks de entrada

Webhooks (Twilio confirma entrega, Asaas confirma pagamento) chegam no Route Handler do app, vindos da internet. Em E2E, **dispare manualmente** via `request` API (HTTP cliente do Playwright):

```ts
test('cobrança vira "paga" quando webhook do Asaas chega', async ({ page, request }) => {
  // ... cria cobrança via UI ...

  await request.post(`${page.url().split('/agenda')[0]}/api/webhooks/asaas`, {
    headers: { 'asaas-access-token': process.env.ASAAS_WEBHOOK_TOKEN! },
    data: { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_test' } },
  });

  await page.reload();
  await expect(page.getByRole('row', { name: /pago/i })).toBeVisible();
});
```

## Integrações server-side (Resend, Gemini, Receita Saúde)

`page.route()` **não vê** chamadas feitas pelo Next.js no servidor. Estratégias:

1. **Env var apontando para mock**: app lê `RESEND_BASE_URL` (ou similar) que em test aponta para `http://localhost:3101`. Suba um pequeno servidor mock nesse port no `globalSetup`.
2. **`vi.mock` no nível do módulo do app não funciona em E2E** — Playwright não tem hook nesse nível.
3. **Mock provider via DI no app**: se o app aceita injeção do cliente externo (ex.: `getResendClient()` lê env e retorna real ou stub), force stub em `NODE_ENV=test`.
4. **Ignorar** se a integração é puramente lateral e o teste consegue asseverar o efeito visível (ex.: app marca `email_enviado: true` no DB — basta checar isso).

A opção 3 é a mais limpa quando o app já tem essa abstração; senão, a opção 4 cobre 80% dos casos.

## Checklist

- [ ] Toda chamada externa do navegador interceptada no fixture (auto: true).
- [ ] Nenhum teste depende de Twilio/Asaas reais (procurar por `https://api.` em specs).
- [ ] Cenários de erro (503, timeout) cobertos para fluxos críticos.
- [ ] Webhooks de entrada disparados via `request.post` no próprio teste.
