# Server Actions and Route Handlers in integration

In integration, the Server Action / Route Handler runs **with real Drizzle against the container**. Only **outbound** integrations (Twilio, Resend, Receita Saúde, Asaas, Inngest, Gemini) are mocked — via MSW if they are HTTP, or via `vi.mock` if they are SDKs.

## Server Action — standard flow

```ts
// src/__tests__/integration/app/(app)/agenda/actions.int.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__tests__/integration/setup/msw-server';
import { db } from '@/__tests__/integration/setup/db';
import { runAsUser, runAsService, truncateAll } from '@/__tests__/integration/setup/rls';
import { agendamentos } from '@/shared/db/schema';
import { eq } from 'drizzle-orm';
import { agendarConsulta } from '@/modules/agenda/server/agendar-consulta';
import { createPsicologo } from '@/__tests__/integration/factories/psicologo';
import { createPaciente } from '@/__tests__/integration/factories/paciente';

vi.mock('@/shared/lib/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ['evt_1'] }) },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/shared/supabase/server', async () => {
  // Makes the Server Action see the scoped connection from the runAsUser helper
  const { getScopedClient } = await import('@/__tests__/integration/setup/rls');
  return { createServerClient: () => getScopedClient() };
});

import { inngest } from '@/shared/lib/inngest/client';

describe('agendarConsulta', () => {
  beforeEach(() => truncateAll(db));

  it('creates appointment, dispatches event and returns success', async () => {
    const dr = await createPsicologo();
    const paciente = await createPaciente({ psicologoId: dr.id });

    const resultado = await runAsUser(dr.id, () =>
      agendarConsulta({
        pacienteId: paciente.id,
        horario: '2026-06-01T14:00:00-03:00',
      })
    );

    expect(resultado).toMatchObject({ ok: true });

    const persistido = await runAsService((admin) =>
      admin.select().from(agendamentos).where(eq(agendamentos.id, resultado.id))
    );
    expect(persistido).toHaveLength(1);
    expect(persistido[0].pacienteId).toBe(paciente.id);

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agenda/lembrete.agendar' })
    );
  });

  it('rejects when patient belongs to another psychologist (RLS blocks read)', async () => {
    const dr_a = await createPsicologo();
    const dr_b = await createPsicologo();
    const pacienteDeA = await createPaciente({ psicologoId: dr_a.id });

    await expect(
      runAsUser(dr_b.id, () =>
        agendarConsulta({
          pacienteId: pacienteDeA.id,
          horario: '2026-06-01T14:00:00-03:00',
        })
      )
    ).rejects.toThrow(/paciente não encontrado/i);
  });
});
```

Note: the test does **not** mock the DB, does **not** mock Drizzle, does **not** mock the policy. Only the outbound boundaries (Inngest, revalidatePath) and the function that creates the Supabase client (to use the scoped connection from the helper). Import the Server Action **directly from the module** (`@/modules/agenda/server/...`) — the route shell at `src/app/(app)/agenda/actions.ts` is just a `'use server'` wrapper that delegates.

## Webhook Route Handler (Twilio/Asaas)

Webhooks are `Request → Response`. Build them natively:

```ts
import { POST } from '@/app/api/webhooks/asaas/route';

it('marks billing as paid when receiving PAYMENT_CONFIRMED webhook', async () => {
  const dr = await createPsicologo();
  const cobranca = await runAsService((admin) =>
    admin.insert(cobrancas).values({
      psicologoId: dr.id,
      asaasId: 'pay_123',
      status: 'pendente',
    }).returning()
  );

  const payload = JSON.stringify({
    event: 'PAYMENT_CONFIRMED',
    payment: { id: 'pay_123' },
  });
  const req = new Request('http://localhost/api/webhooks/asaas', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'asaas-access-token': process.env.ASAAS_WEBHOOK_TOKEN!,
    },
    body: payload,
  });

  const res = await POST(req);
  expect(res.status).toBe(200);

  const atualizada = await runAsService((admin) =>
    admin.select().from(cobrancas).where(eq(cobrancas.id, cobranca[0].id))
  );
  expect(atualizada[0].status).toBe('paga');
});
```

## Mocking outbound integrations via MSW

If the handler **emits** an HTTP call (e.g., notify Twilio), use MSW:

```ts
beforeEach(() => {
  server.use(
    http.post('https://api.twilio.com/*/Messages.json', async ({ request }) => {
      const body = await request.formData();
      twilioPayloads.push(Object.fromEntries(body));
      return HttpResponse.json({ sid: 'SM_test', status: 'queued' });
    })
  );
});
```

Assertions over `twilioPayloads` prove the contract without real network.

## Zod validation at the boundaries

In integration, Zod is exercised naturally — if the schema rejects, the handler never reaches the DB. Do not duplicate tests that already exist as unit tests of the schema; focus on the **path of the error reaching the user** (response shape, status code, reverted transaction).

## Checklist per Server Action

- [ ] Happy path creates/updates the correct state in the DB.
- [ ] RLS is respected (test as another psychologist → error/`null`).
- [ ] Zod validation error returns the expected shape.
- [ ] External boundary failure (MSW returns 500) → consistent state (rollback or scheduled retry).
- [ ] Outbound events/notifications are called with the correct payload.
- [ ] `revalidatePath`/`revalidateTag` called on the right routes.

## What does not belong here

- Real render of the component that triggers the action → use `references/ui-integration-rtl.md`.
- Confirming the email arrived → out of scope (real provider).
- Performance/concurrency under load → dedicated tool.
