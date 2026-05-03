# Padrões de mock no Vitest

## Hoisting do `vi.mock`

`vi.mock` é **hoisted** para o topo do arquivo, **antes** dos `import`. Por isso:

- Nunca referencie variáveis externas dentro da factory (elas ainda não existem). Se precisar, use `vi.hoisted()`.
- O `import` do módulo mockado vem **depois** do `vi.mock`, mas em runtime já estará substituído.

```ts
const { mockedSend } = vi.hoisted(() => ({ mockedSend: vi.fn() }));

vi.mock('@/shared/lib/email/resend', () => ({
  sendEmail: mockedSend,
}));

import { enviarBoasVindas } from '@/modules/onboarding/server/enviar-boas-vindas';
// ... agora `mockedSend` está disponível nos testes
```

## Mocks parciais

Preserve exports não relevantes com `importActual`:

```ts
vi.mock('@/shared/lib/utils/date', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/utils/date')>();
  return {
    ...actual,
    agora: vi.fn(() => new Date('2026-05-01T12:00:00-03:00')),
  };
});
```

## Tipagem dos mocks

Use `vi.mocked` para acessar o mock com tipos preservados:

```ts
import { sendEmail } from '@/shared/lib/email/resend';
vi.mocked(sendEmail).mockResolvedValue({ id: 'msg_1' });
expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(/* ... */);
```

## Cliente Supabase

O builder do Supabase é encadeado (`from().select().eq().single()`). Crie um helper que retorna um proxy chainable:

```ts
// src/__tests__/unit/_helpers/supabase.ts
import { vi } from 'vitest';

export function mockSupabaseQuery<T>(result: { data: T | null; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler: ProxyHandler<typeof builder> = {
    get(target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(result);
      target[prop as string] ??= vi.fn(() => proxy);
      return target[prop as string];
    },
  };
  const proxy = new Proxy(builder, handler);
  return proxy;
}
```

Uso:

```ts
vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/shared/supabase/server';
import { mockSupabaseQuery } from '@/__tests__/unit/_helpers/supabase';

vi.mocked(createServerClient).mockReturnValue({
  from: () => mockSupabaseQuery({ data: [{ id: 'p_1' }], error: null }),
} as never);
```

## Inngest

```ts
vi.mock('@/shared/lib/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ['evt_1'] }) },
}));
```

Asserções de evento despachado:

```ts
expect(inngest.send).toHaveBeenCalledWith({
  name: 'agenda/lembrete.agendado',
  data: expect.objectContaining({ agendamentoId: 'a_1' }),
});
```

## `fetch` e APIs HTTP externas

```ts
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

it('chama Receita Saúde com payload correto', async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );

  await emitirReceita(/* ... */);

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/receita-saude'),
    expect.objectContaining({ method: 'POST' })
  );
});
```

## Tempo (timers, cron, debounce)

```ts
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-05-01T09:00:00-03:00') }));
afterEach(() => vi.useRealTimers());

it('agenda lembrete 24h antes da consulta', async () => {
  await agendarLembrete({ horario: new Date('2026-05-02T14:00:00-03:00') });
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(inngest.send).toHaveBeenCalled();
});
```

## Variáveis de ambiente

```ts
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-key');
});
// reset automático via `unstubEnvs: true` no config
```

## Spy preservando original

```ts
import * as logger from '@/shared/lib/logger';

const spy = vi.spyOn(logger, 'info');
// ...
expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'paciente.criado' }));
// `restoreMocks: true` restaura no afterEach
```

## Anti-receitas

- **Não** mocke `next/navigation`, `next/headers` globalmente — mocke por arquivo apenas onde a função sob teste consome.
- **Não** stub `console` para silenciar logs reais; ajuste o nível do logger ou ignore por configuração.
- **Não** mocke Zod — valide com payloads reais para detectar regressão de schema.
