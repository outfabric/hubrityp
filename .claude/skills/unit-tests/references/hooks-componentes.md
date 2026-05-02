# Testando hooks e componentes (unitário)

Mantenha o escopo pequeno: hook isolado, componente puro, lógica de form. Render de página inteira ou fluxo de navegação é E2E (Playwright).

## Pré-requisitos no arquivo

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
```

`vitest.setup.ts` já importa `@testing-library/jest-dom/vitest` e roda `cleanup()` no `afterEach`.

## Hook isolado com `renderHook`

```ts
import { renderHook, act } from '@testing-library/react';
import { useContador } from './useContador';

describe('useContador', () => {
  it('incrementa de 1 em 1 a partir do valor inicial', () => {
    const { result } = renderHook(() => useContador(5));

    act(() => result.current.incrementar());

    expect(result.current.valor).toBe(6);
  });
});
```

Para hooks que dependem de provider (TanStack Query, Theme, etc.), use o `wrapper`:

```ts
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const { result } = renderHook(() => usePaciente('p_1'), { wrapper });
```

## Componentes — buscar por papel acessível

Prefira `getByRole`/`getByLabelText` em vez de `getByTestId` ou seletores CSS. Isso mantém o teste alinhado a como o usuário (e leitores de tela) percebem a UI.

```tsx
import { BotaoSalvar } from './BotaoSalvar';

it('chama onSubmit quando clicado', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<BotaoSalvar onSubmit={onSubmit} />);
  await user.click(screen.getByRole('button', { name: /salvar/i }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});
```

Use `userEvent` (não `fireEvent`) — simula sequência real de eventos do navegador (focus, keydown, input, change).

## Formulários (React Hook Form + Zod)

Teste **comportamento do form**, não internals do RHF:

```tsx
it('mostra erro quando CPF é inválido e bloqueia submit', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<FormularioPaciente onSubmit={onSubmit} />);
  await user.type(screen.getByLabelText(/cpf/i), '111.111.111-11');
  await user.click(screen.getByRole('button', { name: /cadastrar/i }));

  expect(await screen.findByText(/cpf inválido/i)).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});
```

`findBy*` aguarda elementos que aparecem assincronamente (validação async, transitions). `getBy*` falha se não está presente já.

## React Server Components (RSC)

RSC com `async` e acesso a banco/headers **não roda** no Vitest (é uma camada do Next que exige bundler/server real). Estratégias:

1. **Extraia a lógica** do RSC para um módulo puro e teste o módulo.
   ```ts
   // app/(app)/agenda/page.tsx → fina; chama buscarAgendaDoDia()
   // lib/agenda/queries.ts     → testável (mockando Supabase)
   ```
2. Para a parte JSX puramente apresentacional, exporte um **Client Component** filho que recebe dados via props e teste-o com Testing Library.
3. Não tente "renderizar a página" no Vitest — isso é trabalho do E2E Playwright.

## Acessibilidade básica

Inclua pelo menos uma asserção que prove que o usuário consegue interagir:

- Inputs têm `<label>` associado (`getByLabelText` resolve sem hack).
- Botões têm texto acessível (`getByRole('button', { name: /.../ })`).
- Estados de loading/erro são anunciados (`role="status"`, `aria-live`).

## Asserções comuns

| Intenção | Asserção |
|---|---|
| Elemento visível | `expect(el).toBeInTheDocument()` |
| Texto presente | `expect(screen.getByText(/.../)).toBeVisible()` |
| Input com valor | `expect(input).toHaveValue('Maria')` |
| Botão desabilitado | `expect(btn).toBeDisabled()` |
| Classe aplicada | `expect(el).toHaveClass('bg-red-500')` |
| Atributo ARIA | `expect(el).toHaveAttribute('aria-invalid', 'true')` |

## O que evitar

- `screen.debug()` deixado no commit final.
- Snapshot de DOM inteiro (quebra por refator de Tailwind/whitespace).
- `await new Promise(r => setTimeout(r, 50))` para "esperar render" — use `findBy*` ou `waitFor`.
- Testar lib de terceiros (RHF, Zod, shadcn/ui) — confie nos testes deles.
