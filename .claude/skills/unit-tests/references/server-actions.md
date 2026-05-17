# Testing Server Actions, Route Handlers, and Zod validation

Server Actions and Route Handlers are the **boundaries** of the app. The unit test should cover:

1. Input validation (rejects invalid payload with actionable error).
2. Happy path (calls dependencies with correct arguments).
3. Dependency error path (Supabase fails, queue fails, etc.).
4. Expected side effects (events dispatched, structured log, revalidatePath).

Not covered here: real render, actual RLS, end-to-end flow. That's integration/E2E.

## Where the Server Action lives in HubrityP

The **real** Server Action lives in `src/modules/<domain>/server/<action>.ts`. The file at `src/app/(...)/.../actions.ts` is just a `'use server'` shell that delegates:

```ts
// src/app/(auth)/login/actions.ts (route shell)
'use server';
export { signIn } from '@/modules/auth';

// src/modules/auth/server/login.ts (real implementation, without 'use server')
export async function signInImpl(formData: FormData): Promise<SignInResult> { /* ... */ }
```

For a unit test, import **directly from the module** (without the shell). For an integration test you can import from the shell (`@/app/(auth)/login/actions`), which is especially useful because the shell already has `'use server'` and simulates the real entrypoint.

## Suggested structure

```ts
// src/__tests__/unit/modules/agenda/server/agendar.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/shared/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/shared/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }));

import { revalidatePath } from 'next/cache';
import { inngest } from '@/shared/lib/inngest/client';
import { createServerClient } from '@/shared/supabase/server';
import { mockSupabaseQuery } from '@/__tests__/unit/_helpers/supabase';
import { agendar } from '@/modules/agenda/server/agendar';

describe('agendar (Server Action)', () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockReturnValue({
      from: () => mockSupabaseQuery({ data: { id: 'a_1' }, error: null }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u_1' } } }) },
    } as never);
  });

  it('rejects time in the past', async () => {
    await expect(
      agendar({ pacienteId: 'p_1', horario: '2020-01-01T10:00:00-03:00' })
    ).rejects.toThrow(/horário.*passado/i);
  });

  it('creates appointment, dispatches reminder, and revalidates agenda', async () => {
    const result = await agendar({
      pacienteId: 'p_1',
      horario: '2026-06-01T10:00:00-03:00',
    });

    expect(result).toEqual({ ok: true, id: 'a_1' });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agenda/lembrete.agendar' })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/agenda');
  });
});
```

## Isolated Zod validation

Test the schema separately. Faster, more expressive:

```ts
// src/__tests__/unit/modules/pacientes/lib/criar-paciente-schema.test.ts
import { describe, it, expect } from 'vitest';
import { criarPacienteSchema } from '@/modules/pacientes/lib/criar-paciente-schema';

describe('criarPacienteSchema', () => {
  it('accepts minimal valid payload', () => {
    const parsed = criarPacienteSchema.parse({
      nome: 'Maria Silva',
      cpf: '529.982.247-25',
    });
    expect(parsed.nome).toBe('Maria Silva');
  });

  it('fails when name has fewer than 2 characters', () => {
    const result = criarPacienteSchema.safeParse({ nome: 'A', cpf: '529.982.247-25' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['nome']);
    }
  });
});
```

Use `safeParse` when you want to inspect `issues`; `parse` when you expect success.

## Route Handlers (webhooks)

Treat the handler as a function `async (req: Request) => Response`. Build a native `Request`:

```ts
// src/__tests__/unit/app/api/webhooks/twilio/route.test.ts
import { POST } from '@/app/api/webhooks/twilio/route';

it('responds 401 when Twilio signature is invalid', async () => {
  const req = new Request('http://localhost/api/webhooks/twilio', {
    method: 'POST',
    headers: { 'x-twilio-signature': 'invalid' },
    body: 'From=...&Body=...',
  });
  const res = await POST(req);
  expect(res.status).toBe(401);
});
```

For handlers that depend on `cookies()` or `headers()` from `next/headers`, mock the module:

```ts
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (k: string) => ({ value: 'fake' }) }),
}));
```

## Assertions on thrown errors

Prefer `rejects.toThrow` with a regex that validates the actionable message:

```ts
await expect(criarPaciente({ nome: '' }))
  .rejects.toThrow(/nome.*obrigatório/i);
```

Avoid `try { ... } catch { expect(...) }` — forgetting `expect.assertions(1)` silently lets the test pass when the function **doesn't** throw.

If you need to inspect the error shape:

```ts
await expect(fn()).rejects.toMatchObject({
  name: 'ValidationError',
  cause: expect.objectContaining({ field: 'cpf' }),
});
```

## Auth and user context

Centralize in a helper to avoid repetition:

```ts
// src/__tests__/unit/_helpers/auth.ts
import { vi } from 'vitest';
import type { createServerClient } from '@/shared/supabase/server';

export function mockUsuarioLogado(
  supabase: ReturnType<typeof createServerClient>,
  userId = 'u_1'
) {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: userId, email: 'test@hubrityp.com' } as never },
    error: null,
  });
}
```

Explicitly test the "not authenticated" case → the Server Action must throw an authorization error.

## What NOT to test here

- That RLS blocks access → integration against real Postgres.
- That the UI component shows the error → E2E Playwright.
- That the Inngest function processes the event → Inngest function integration.

The Server Action under test should trust the boundaries already tested in other layers.
