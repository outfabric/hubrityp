# Server Actions e Route Handlers em integração

Em integração, a Server Action / Route Handler roda **com Drizzle real contra o container**. Apenas integrações **de saída** (Twilio, Resend, Receita Saúde, Asaas, Inngest, Gemini) são mockadas — pelo MSW se forem HTTP, ou via `vi.mock` se forem SDKs.

## Server Action — fluxo padrão

```ts
// app/(app)/agenda/actions.int.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__tests__/integration/setup/msw-server';
import { db } from '@/__tests__/integration/setup/db';
import { runAsUser, runAsService, truncateAll } from '@/__tests__/integration/setup/rls';
import { agendamentos } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { agendarConsulta } from './actions';
import { createPsicologo } from '@/__tests__/integration/factories/psicologo';
import { createPaciente } from '@/__tests__/integration/factories/paciente';

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ['evt_1'] }) },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', async () => {
  // Faz a Server Action enxergar a conexão escopada do helper runAsUser
  const { getScopedClient } = await import('@/__tests__/integration/setup/rls');
  return { createServerClient: () => getScopedClient() };
});

import { inngest } from '@/lib/inngest/client';

describe('agendarConsulta', () => {
  beforeEach(() => truncateAll(db));

  it('cria agendamento, dispara evento e responde sucesso', async () => {
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

  it('rejeita quando paciente é de outro psicólogo (RLS bloqueia leitura)', async () => {
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

Observe: o teste **não** mocka o DB, **não** mocka Drizzle, **não** mocka a policy. Apenas as fronteiras de saída (Inngest, revalidatePath) e a função que cria o cliente Supabase (para usar a conexão escopada do helper).

## Route Handler de webhook (Twilio/Asaas)

Webhooks são `Request → Response`. Construa nativo:

```ts
import { POST } from '@/app/api/webhooks/asaas/route';

it('marca cobrança como paga ao receber webhook PAYMENT_CONFIRMED', async () => {
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

## Mockando integrações de saída via MSW

Se o handler **emite** uma chamada HTTP (ex.: notificar Twilio), use MSW:

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

Asserções sobre `twilioPayloads` provam o contrato sem rede real.

## Validação Zod nas fronteiras

Em integração, Zod é exercitado naturalmente — se o schema rejeita, o handler nunca chega no DB. Não duplique testes que já existem como unitários do schema; foque no **caminho do erro chegando ao usuário** (formato da resposta, status code, transação revertida).

## Checklist por Server Action

- [ ] Caminho feliz cria/atualiza estado correto no DB.
- [ ] RLS é respeitada (testar como outro psicólogo → erro/`null`).
- [ ] Erro de validação Zod retorna formato esperado.
- [ ] Falha de fronteira externa (MSW retorna 500) → estado consistente (rollback ou retry agendado).
- [ ] Eventos/notificações de saída são chamados com payload correto.
- [ ] `revalidatePath`/`revalidateTag` chamado nas rotas certas.

## O que não pertence aqui

- Render real do componente que dispara a action → use `references/ui-integration-rtl.md`.
- Confirmar que o e-mail chegou → fora do escopo (provedor real).
- Performance/concorrência sob carga → ferramenta dedicada.
