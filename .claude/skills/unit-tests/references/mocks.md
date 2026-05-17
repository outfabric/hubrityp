# Mock patterns in Vitest

## `vi.mock` hoisting

`vi.mock` is **hoisted** to the top of the file, **before** the `import`s. Therefore:

- Never reference external variables inside the factory (they don't exist yet). If you need to, use `vi.hoisted()`.
- The `import` of the mocked module comes **after** the `vi.mock`, but at runtime it will already be replaced.

```ts
const { mockedSend } = vi.hoisted(() => ({ mockedSend: vi.fn() }));

vi.mock('@/shared/lib/email/resend', () => ({
  sendEmail: mockedSend,
}));

import { enviarBoasVindas } from '@/modules/onboarding/server/enviar-boas-vindas';
// ... `mockedSend` is now available in the tests
```

## Partial mocks

Preserve non-relevant exports with `importActual`:

```ts
vi.mock('@/shared/lib/utils/date', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/utils/date')>();
  return {
    ...actual,
    agora: vi.fn(() => new Date('2026-05-01T12:00:00-03:00')),
  };
});
```

## Typing mocks

Use `vi.mocked` to access the mock with types preserved:

```ts
import { sendEmail } from '@/shared/lib/email/resend';
vi.mocked(sendEmail).mockResolvedValue({ id: 'msg_1' });
expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(/* ... */);
```

## Supabase client

The Supabase builder is chained (`from().select().eq().single()`). Create a helper that returns a chainable proxy:

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

Usage:

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

Assertions about the dispatched event:

```ts
expect(inngest.send).toHaveBeenCalledWith({
  name: 'agenda/lembrete.agendado',
  data: expect.objectContaining({ agendamentoId: 'a_1' }),
});
```

## `fetch` and external HTTP APIs

```ts
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

it('calls Receita Saúde with correct payload', async () => {
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

## Time (timers, cron, debounce)

```ts
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-05-01T09:00:00-03:00') }));
afterEach(() => vi.useRealTimers());

it('schedules reminder 24h before appointment', async () => {
  await agendarLembrete({ horario: new Date('2026-05-02T14:00:00-03:00') });
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(inngest.send).toHaveBeenCalled();
});
```

## Environment variables

```ts
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-key');
});
// automatic reset via `unstubEnvs: true` in config
```

## Spy preserving the original

```ts
import * as logger from '@/shared/lib/logger';

const spy = vi.spyOn(logger, 'info');
// ...
expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'paciente.criado' }));
// `restoreMocks: true` restores in afterEach
```

## Anti-recipes

- **Don't** mock `next/navigation`, `next/headers` globally — mock per file only where the function under test consumes it.
- **Don't** stub `console` to silence real logs; adjust the logger level or ignore via configuration.
- **Don't** mock Zod — validate with real payloads to catch schema regression.
