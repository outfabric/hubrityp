# Integrated UI with React Testing Library + MSW

Difference vs. a component unit test:

| Criterion | Unit (skill `unit-tests`) | Integration (this skill) |
|---|---|---|
| Providers | Minimal / mocked | **Real** (TanStack Query, Theme, Toaster) |
| HTTP layer | `vi.mock` / `vi.stubGlobal('fetch')` | **MSW** (handler per request) |
| Server Action | Mocked | Real (real Drizzle on the container) or simulated via MSW |
| DB | Does not touch | Real (Postgres in container) when the path requires it |
| Speed | <100ms | 200ms–2s |
| When to use | Isolated component, hook | Flow: form → action → revalidate → toast |

## MSW setup

```ts
// src/__tests__/integration/setup/msw-server.ts
import { setupServer } from 'msw/node';
export const server = setupServer();
```

Already registered in Vitest's `setup.ts` with `onUnhandledRequest: 'error'` (see `references/testcontainers-setup.md`).

## Renderer with real providers

```tsx
// src/__tests__/integration/setup/render.tsx
import { ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/shared/ui/sonner';

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

`retry: false` avoids waiting 3 attempts in the test. `gcTime: 0` releases cache immediately.

## Example: form → Server Action → toast

The Server Action is imported **for real**, but the DB boundary can be mocked via MSW (if the action calls an internal Route Handler) or via real DB (if the action uses Drizzle directly). For a UI flow, **prefer mocking the Server Action via MSW** — the test focuses on the UI, not the DB.

```tsx
// src/__tests__/integration/modules/pacientes/components/novo-paciente-form.int.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/integration/setup/render';
import { server } from '@/__tests__/integration/setup/msw-server';
import { NovoPacienteForm } from '@/modules/pacientes/components/novo-paciente-form';

describe('NovoPacienteForm — integration', () => {
  it('submits, shows success toast and clears the form', async () => {
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

  it('shows server message when POST fails', async () => {
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

## When it's worth going all the way to the DB

For flows that depend on **cache invalidation** affecting the next query (e.g., create patient → list updates), it may be worth rendering `<ListaPacientes/>` together and proving that the new row appears. In that case:

1. MSW responds to `POST /api/pacientes` by calling the real Server Action (which writes to the DB).
2. MSW intercepts `GET /api/pacientes` reading from the real DB via Drizzle.
3. RTL waits with `findByText('Maria Silva')`.

Trade-off: complex. Reserve for 1–2 critical product flows (e.g., schedule appointment + reflect on agenda).

## Wait patterns (no `setTimeout`)

```ts
await screen.findByRole('status', { name: /salvando/i });    // entered loading
await waitForElementToBeRemoved(() => screen.queryByRole('status'));
await screen.findByText(/sucesso/i);                          // final text
```

`findBy*` polls until `testTimeout` or until found — replaces `await new Promise(r => setTimeout(r, X))`.

## Accessibility as first-class

Include at least one assertion that proves basic accessibility:
- `getByLabelText` for inputs (proves `<label htmlFor>` is correct).
- `getByRole('button', { name: /.../ })` (proves accessible name).
- `aria-invalid="true"` on fields with errors.

If you want to go further, integrate `axe-core` via `vitest-axe` in a single smoke suite per page.

## Do not

- Render an entire page (`src/app/(app)/agenda/page.tsx`) with Next providers — that is E2E. Prefer rendering the main **client component** with props.
- Large snapshots — break on Tailwind / text changes.
- Test third-party libs (shadcn/ui, RHF) — trust their tests.
- Wait with `setTimeout`. Always `findBy*` or `waitFor`.
