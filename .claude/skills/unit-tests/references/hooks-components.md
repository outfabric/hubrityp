# Testing hooks and components (unit)

Keep the scope small: isolated hook, pure component, form logic. Full-page rendering or navigation flow is E2E (Playwright).

## File prerequisites

```ts
// The .test.tsx suffix already triggers jsdom via environmentMatchGlobs in vitest.config.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
```

`vitest.setup.ts` already imports `@testing-library/jest-dom/vitest` and runs `cleanup()` in `afterEach`.

## Isolated hook with `renderHook`

```ts
// src/__tests__/unit/modules/agenda/hooks/use-contador.test.ts
import { renderHook, act } from '@testing-library/react';
import { useContador } from '@/modules/agenda/hooks/use-contador';

describe('useContador', () => {
  it('increments by 1 starting from the initial value', () => {
    const { result } = renderHook(() => useContador(5));

    act(() => result.current.incrementar());

    expect(result.current.valor).toBe(6);
  });
});
```

For hooks that depend on a provider (TanStack Query, Theme, etc.), use the `wrapper`:

```ts
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const { result } = renderHook(() => usePaciente('p_1'), { wrapper });
```

## Components — query by accessible role

Prefer `getByRole`/`getByLabelText` over `getByTestId` or CSS selectors. This keeps the test aligned with how the user (and screen readers) perceive the UI.

```tsx
// src/__tests__/unit/modules/agenda/components/botao-salvar.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotaoSalvar } from '@/modules/agenda/components/botao-salvar';

it('calls onSubmit when clicked', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<BotaoSalvar onSubmit={onSubmit} />);
  await user.click(screen.getByRole('button', { name: /salvar/i }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});
```

Use `userEvent` (not `fireEvent`) — it simulates the real browser event sequence (focus, keydown, input, change).

## Forms (React Hook Form + Zod)

Test **form behavior**, not RHF internals:

```tsx
// src/__tests__/unit/modules/pacientes/components/formulario-paciente.test.tsx
import { FormularioPaciente } from '@/modules/pacientes/components/formulario-paciente';

it('shows error when CPF is invalid and blocks submit', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<FormularioPaciente onSubmit={onSubmit} />);
  await user.type(screen.getByLabelText(/cpf/i), '111.111.111-11');
  await user.click(screen.getByRole('button', { name: /cadastrar/i }));

  expect(await screen.findByText(/cpf inválido/i)).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});
```

`findBy*` waits for elements that appear asynchronously (async validation, transitions). `getBy*` fails if not already present.

## Client Components that import Server Actions

Client Components consume Server Actions from the **route shell** (`@/app/(auth)/login/actions`), not from the module barrel (`@/modules/auth`). The barrel drags `server-only` into the graph, and Next's RSC checker breaks the build.

In a unit test of the client component, mock the action **at the path the component uses**:

```ts
// The component imports from '@/app/(auth)/login/actions'
vi.mock('@/app/(auth)/login/actions', () => ({
  signIn: vi.fn().mockResolvedValue({ ok: true }),
}));

import { signIn } from '@/app/(auth)/login/actions';
import { LoginForm } from '@/modules/auth/components/login-form';
```

Mocking the barrel path (`@/modules/auth`) **won't** work — the component doesn't import through it.

## React Server Components (RSC)

RSC with `async` and access to database/headers **doesn't run** in Vitest (it's a Next layer that requires a real bundler/server). Strategies:

1. **Extract the logic** out of the RSC into a pure module and test the module.
   ```ts
   // src/app/(app)/agenda/page.tsx → thin; calls buscarAgendaDoDia()
   // src/modules/agenda/lib/queries.ts → testable (mocking Supabase)
   ```
2. For the purely presentational JSX part, export a child **Client Component** that receives data via props and test it with Testing Library.
3. Don't try to "render the page" in Vitest — that's E2E Playwright's job.

## Basic accessibility

Include at least one assertion that proves the user can interact:

- Inputs have an associated `<label>` (`getByLabelText` resolves without a hack).
- Buttons have accessible text (`getByRole('button', { name: /.../ })`).
- Loading/error states are announced (`role="status"`, `aria-live`).

## Common assertions

| Intent | Assertion |
|---|---|
| Element visible | `expect(el).toBeInTheDocument()` |
| Text present | `expect(screen.getByText(/.../)).toBeVisible()` |
| Input with value | `expect(input).toHaveValue('Maria')` |
| Button disabled | `expect(btn).toBeDisabled()` |
| Class applied | `expect(el).toHaveClass('bg-red-500')` |
| ARIA attribute | `expect(el).toHaveAttribute('aria-invalid', 'true')` |

## What to avoid

- `screen.debug()` left in the final commit.
- Full DOM snapshot (breaks on Tailwind/whitespace refactor).
- `await new Promise(r => setTimeout(r, 50))` to "wait for render" — use `findBy*` or `waitFor`.
- Testing third-party libs (RHF, Zod, shadcn/ui) — trust their tests.
