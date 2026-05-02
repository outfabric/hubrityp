# Testando Server Actions, Route Handlers e validação Zod

Server Actions e Route Handlers são as **fronteiras** do app. O teste unitário deve cobrir:

1. Validação de entrada (rejeita payload inválido com erro acionável).
2. Caminho feliz (chama dependências com argumentos corretos).
3. Caminho de erro de dependência (Supabase falha, fila falha, etc.).
4. Efeitos colaterais esperados (eventos disparados, log estruturado, revalidatePath).

Não cobrir aqui: render real, RLS de fato, fluxo end-to-end. Isso é integração/E2E.

## Estrutura sugerida

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }));

import { revalidatePath } from 'next/cache';
import { inngest } from '@/lib/inngest/client';
import { createServerClient } from '@/lib/supabase/server';
import { mockSupabaseQuery } from '@/__tests__/helpers/supabase';
import { agendar } from './actions';

describe('agendar (Server Action)', () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockReturnValue({
      from: () => mockSupabaseQuery({ data: { id: 'a_1' }, error: null }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u_1' } } }) },
    } as never);
  });

  it('rejeita horário no passado', async () => {
    await expect(
      agendar({ pacienteId: 'p_1', horario: '2020-01-01T10:00:00-03:00' })
    ).rejects.toThrow(/horário.*passado/i);
  });

  it('cria agendamento, dispara lembrete e revalida agenda', async () => {
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

## Validação Zod isolada

Teste o schema separadamente. Mais rápido, mais expressivo:

```ts
// app/(app)/pacientes/schema.test.ts
import { describe, it, expect } from 'vitest';
import { criarPacienteSchema } from './schema';

describe('criarPacienteSchema', () => {
  it('aceita payload mínimo válido', () => {
    const parsed = criarPacienteSchema.parse({
      nome: 'Maria Silva',
      cpf: '529.982.247-25',
    });
    expect(parsed.nome).toBe('Maria Silva');
  });

  it('falha quando nome tem menos de 2 caracteres', () => {
    const result = criarPacienteSchema.safeParse({ nome: 'A', cpf: '529.982.247-25' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['nome']);
    }
  });
});
```

Use `safeParse` quando quiser inspecionar `issues`; `parse` quando esperar sucesso.

## Route Handlers (webhooks)

Trate o handler como função `async (req: Request) => Response`. Construa `Request` nativo:

```ts
import { POST } from '@/app/api/webhooks/twilio/route';

it('responde 401 quando assinatura Twilio é inválida', async () => {
  const req = new Request('http://localhost/api/webhooks/twilio', {
    method: 'POST',
    headers: { 'x-twilio-signature': 'invalid' },
    body: 'From=...&Body=...',
  });
  const res = await POST(req);
  expect(res.status).toBe(401);
});
```

Para handlers que dependem de `cookies()` ou `headers()` do `next/headers`, mocke o módulo:

```ts
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (k: string) => ({ value: 'fake' }) }),
}));
```

## Asserções sobre erros lançados

Prefira `rejects.toThrow` com regex que valida a mensagem acionável:

```ts
await expect(criarPaciente({ nome: '' }))
  .rejects.toThrow(/nome.*obrigatório/i);
```

Evite `try { ... } catch { expect(...) }` — esquecer o `expect.assertions(1)` deixa o teste passar silenciosamente quando a função **não** lança.

Se precisar inspecionar a forma do erro:

```ts
await expect(fn()).rejects.toMatchObject({
  name: 'ValidationError',
  cause: expect.objectContaining({ field: 'cpf' }),
});
```

## Auth e contexto de usuário

Centralize em um helper para evitar repetição:

```ts
// __tests__/helpers/auth.ts
export function mockUsuarioLogado(supabase: ReturnType<typeof createServerClient>, userId = 'u_1') {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: userId, email: 'test@hubrityp.com' } as never },
    error: null,
  });
}
```

Teste explicitamente o caso "não autenticado" → Server Action deve lançar erro de autorização.

## O que NÃO testar aqui

- Que o RLS impede acesso → integração contra Supabase local.
- Que o componente de UI mostra o erro → E2E Playwright.
- Que a função do Inngest processa o evento → integração da função Inngest.

A Server Action testada deve confiar nas fronteiras já testadas em outras camadas.
