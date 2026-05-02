# UI integrada com React Testing Library + MSW

Diferença para teste unitário de componente:

| Critério | Unitário (skill `testes-unitarios-vitest`) | Integração (esta skill) |
|---|---|---|
| Providers | Mínimos / mockados | **Reais** (TanStack Query, Theme, Toaster) |
| Camada HTTP | `vi.mock` / `vi.stubGlobal('fetch')` | **MSW** (handler por request) |
| Server Action | Mockada | Real (Drizzle real no container) ou simulada via MSW |
| Banco | Não toca | Real (Postgres em container) quando o caminho exige |
| Velocidade | <100ms | 200ms–2s |
| Quando usar | Componente isolado, hook | Fluxo: form → action → revalidate → toast |

## Setup do MSW

```ts
// __tests__/integration/setup/msw-server.ts
import { setupServer } from 'msw/node';
export const server = setupServer();
```

Já registrado no `setup.ts` do Vitest com `onUnhandledRequest: 'error'` (ver `references/testcontainers-setup.md`).

## Renderizador com providers reais

```tsx
// __tests__/integration/setup/render.tsx
import { ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';

export function renderWithProviders(ui: ReactNode, opts?: RenderOptions) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
    opts
  );
}
```

`retry: false` evita esperar 3 tentativas no teste. `gcTime: 0` libera cache imediatamente.

## Exemplo: formulário → Server Action → toast

A Server Action é importada **real**, mas a fronteira de DB pode ser mockada via MSW (se a action chama uma Route Handler interna) ou via DB real (se a action usa Drizzle direto). Para fluxo de UI, **prefira mockar a Server Action via MSW** — o teste foca na UI, não no banco.

```tsx
// app/(app)/pacientes/novo-paciente-form.int.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/integration/setup/render';
import { server } from '@/__tests__/integration/setup/msw-server';
import { NovoPacienteForm } from './novo-paciente-form';

describe('NovoPacienteForm — integração', () => {
  it('submete, mostra toast de sucesso e limpa o form', async () => {
    let payloadEnviado: unknown;
    server.use(
      http.post('/api/pacientes', async ({ request }) => {
        payloadEnviado = await request.json();
        return HttpResponse.json({ ok: true, id: 'p_1' }, { status: 201 });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(<NovoPacienteForm />);

    await user.type(screen.getByLabelText(/nome/i), 'Maria Silva');
    await user.type(screen.getByLabelText(/cpf/i), '529.982.247-25');
    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText(/paciente cadastrado/i)).toBeVisible();
    expect(payloadEnviado).toEqual({
      nome: 'Maria Silva',
      cpf: '529.982.247-25',
    });
    expect(screen.getByLabelText(/nome/i)).toHaveValue('');
  });

  it('mostra mensagem do servidor quando POST falha', async () => {
    server.use(
      http.post('/api/pacientes', () =>
        HttpResponse.json({ error: 'CPF já cadastrado' }, { status: 409 })
      )
    );

    const user = userEvent.setup();
    renderWithProviders(<NovoPacienteForm />);

    await user.type(screen.getByLabelText(/nome/i), 'Maria');
    await user.type(screen.getByLabelText(/cpf/i), '529.982.247-25');
    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText(/cpf já cadastrado/i)).toBeVisible();
  });
});
```

## Quando vale ir até o DB

Para fluxos que dependem de **invalidação de cache** que afeta a próxima query (ex.: criar paciente → lista atualiza), pode valer renderizar a `<ListaPacientes/>` junto e provar que a nova linha aparece. Nesse caso:

1. MSW responde a `POST /api/pacientes` chamando a Server Action real (que escreve no DB).
2. MSW intercepta `GET /api/pacientes` lendo do DB real via Drizzle.
3. RTL espera com `findByText('Maria Silva')`.

Trade-off: complexo. Reserve para 1–2 fluxos críticos do produto (ex.: agendar consulta + reflete na agenda).

## Padrões de espera (sem `setTimeout`)

```ts
await screen.findByRole('status', { name: /salvando/i });    // entrou em loading
await waitForElementToBeRemoved(() => screen.queryByRole('status'));
await screen.findByText(/sucesso/i);                          // texto final
```

`findBy*` faz polling até `testTimeout` ou até achar — substitui `await new Promise(r => setTimeout(r, X))`.

## Acessibilidade como first-class

Inclua pelo menos uma asserção que prove acessibilidade básica:
- `getByLabelText` para inputs (prova que `<label htmlFor>` está correto).
- `getByRole('button', { name: /.../ })` (prova nome acessível).
- `aria-invalid="true"` em campos com erro.

Se quiser ir além, integre `axe-core` via `vitest-axe` em uma única suíte de smoke por página.

## Não fazer

- Render de página inteira (`app/(app)/agenda/page.tsx`) com providers do Next — isso é E2E. Prefira renderizar o **componente cliente** principal com props.
- Snapshots grandes — quebram por mudanças de Tailwind / texto.
- Testar lib de terceiros (shadcn/ui, RHF) — confie nos testes deles.
- Esperar com `setTimeout`. Sempre `findBy*` ou `waitFor`.
