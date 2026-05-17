---
name: unit-tests
description: Best practices for writing unit tests with Vitest in TypeScript + Next.js (App Router) projects. Use whenever you need to create, review, or refactor unit tests — for pure logic, Zod validators, helpers, React hooks, Server Actions, Route Handlers, or utilities — in Next.js projects with TypeScript. Also applies when the user asks to "add tests", "write a spec", "cover with tests", "mock a module", configure Vitest, or when a new feature needs unit coverage before PR.
---

# Unit tests with Vitest (Next.js + TypeScript)

Skill for the `fullstack-developer` subagent to produce consistent, fast, and reliable unit tests in HubrityP. Stay focused on **isolating the unit**, validating **behavior** (not implementation), and expressing intent via the **test name**.

## When to use Vitest (unit scope)

Use Vitest for what fits at the base of the test pyramid:

- Pure functions, Zod validators, date/currency/string helpers.
- Isolated React hooks (no network), reducers, Zustand stores.
- Server Action and Route Handler logic **with mocked dependencies** (Supabase, Inngest, Resend, Twilio).
- Mappers between external payloads and internal models.

Do not use Vitest for:

- End-to-end UI flow → use **Playwright** (E2E).
- Real queries against Supabase, RLS, migrations → use **integration tests** against real Postgres via Docker (Testcontainers).
- Heavy visual/snapshot rendering → prefer behavior assertions.

## Principles

1. **Explicit AAA**: visually separated blocks of Arrange / Act / Assert. One primary assertion per test; auxiliary assertions only if they reinforce the same intent.
2. **Name describes behavior**: `it('rejects CPF with repeating digits', ...)`. No `it('test 1')` or `it('works')`.
3. **Isolate I/O**: no unit test touches the network, database, filesystem, or real clock. Mock at the boundaries.
4. **Determinism**: no `Math.random`, `Date.now`, live UUID v4. Use `vi.useFakeTimers()` and inject clocks/IDs.
5. **No logic in the test**: no `if`, `for`, `switch` inside `it`. If you need to repeat, use `it.each`.
6. **Fails for a clear reason**: the `expect` message should say **what** broke, not **where**.
7. **Fast**: unit tests should run in milliseconds. The whole unit suite < 10s on the dev machine.

## File structure

Unit tests live **centralized** in `src/__tests__/unit/`, with the tree mirroring `src/`. Suffix is `.test.ts` for logic/server and `.test.tsx` for components/hooks (jsdom).

```
src/
  shared/
    lib/
      utils.ts                                          # source
    env/
      schemas.ts
  modules/
    auth/
      lib/
        login-input-schema.ts
        safe-redirect.ts
      components/
        login-form.tsx
  __tests__/
    unit/
      shared/
        lib/
          utils.test.ts                                  # mirrors src/shared/lib/utils.ts
        env/
          schemas.test.ts
      modules/
        auth/
          lib/
            login-input-schema.test.ts
            safe-redirect.test.ts
          components/
            login-form.test.tsx
      e2e/
        seeded/
          setup/
            mock-gotrue.test.ts                          # unit test for an e2e helper
```

> **Why centralized and not co-located**: decision recorded in the `reorganize-folder-structure` change. The cost is an extra editor trip between source and test; the gain is "all tests under a single glob" and no `*.test.ts` lost under `src/`.

> **Test helper vs. test of the helper**: the `mock-gotrue.ts` helper lives in `src/__tests__/e2e/seeded/setup/` (part of e2e infra), but its **unit test** lives in `src/__tests__/unit/e2e/seeded/setup/mock-gotrue.test.ts` (mirroring the actual path under `src/__tests__/`, not under `src/`). This is the pattern for testing files that live outside `src/<domain>` — mirror the real path.

Environment per suite (declared at the top of the file when the default isn't enough):

```ts
// @vitest-environment jsdom   ← only for hooks/components that use the DOM
// @vitest-environment node    ← default for logic/server
```

The project's `vitest.config.ts` already configures `environmentMatchGlobs` to resolve `.test.tsx → jsdom` and `.test.ts → node` automatically.

## Mock choice per situation

| Situation | Tool | Why |
|---|---|---|
| Replace an entire module (e.g., Supabase client, Resend) | `vi.mock('@/shared/supabase/server', () => ({...}))` | Hoisted; avoids real module execution |
| Spy on a method of an existing object preserving the original | `vi.spyOn(obj, 'method')` | Restorable with `mockRestore()` |
| Throwaway function passed as argument | `vi.fn()` | Captures calls and return |
| Time / cron / setTimeout | `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` | Deterministic control |
| Environment variables | `vi.stubEnv('NEXT_PUBLIC_FOO', 'bar')` | Restored by `vi.unstubAllEnvs()` |
| Global `fetch` | `vi.stubGlobal('fetch', vi.fn())` | Restored by `vi.unstubAllGlobals()` |

Always clean up between tests (configure once in `vitest.config.ts` via `clearMocks`, `restoreMocks`, `unstubGlobals`, `unstubEnvs`).

## Canonical example (pure logic + Zod)

```ts
// src/__tests__/unit/modules/pacientes/lib/cpf.test.ts
import { describe, it, expect } from 'vitest';
import { validateCpf } from '@/modules/pacientes/lib/cpf';

describe('validateCpf', () => {
  it.each([
    ['529.982.247-25', true],
    ['52998224725', true],
    ['111.111.111-11', false], // repeating digits
    ['123.456.789-00', false], // invalid check digit
    ['', false],
  ])('validates "%s" as %s', (input, expected) => {
    expect(validateCpf(input)).toBe(expected);
  });
});
```

## Canonical example (Server Action with mocked Supabase)

```ts
// src/__tests__/unit/modules/pacientes/server/criar-paciente.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/shared/supabase/server';
import { criarPaciente } from '@/modules/pacientes/server/criar-paciente';

describe('criarPaciente', () => {
  const insert = vi.fn();
  const select = vi.fn().mockReturnValue({ insert });

  beforeEach(() => {
    vi.mocked(createServerClient).mockReturnValue({ from: () => select } as never);
  });

  it('persists patient with normalized name', async () => {
    insert.mockResolvedValue({ data: { id: 'p_1' }, error: null });

    const result = await criarPaciente({ nome: '  Maria  Silva ', cpf: '529.982.247-25' });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ nome: 'Maria Silva' })
    );
    expect(result).toEqual({ ok: true, id: 'p_1' });
  });

  it('returns actionable error when Supabase fails', async () => {
    insert.mockResolvedValue({ data: null, error: { message: 'duplicate' } });

    await expect(
      criarPaciente({ nome: 'X', cpf: '529.982.247-25' })
    ).rejects.toThrow(/duplicate/);
  });
});
```

> **Imports**: the `@/*` alias resolves to `src/*`. Never import from the tests tree (`@/__tests__/...`) inside production code. For utilities shared between tests, live under `src/__tests__/unit/_helpers/` (or another `_` prefix).

## Antipatterns to avoid

- Testing internal implementation (private variable names, irrelevant call order).
- `expect(true).toBe(true)` or tests that always pass.
- `try/catch` swallowing the exception instead of `await expect(...).rejects.toThrow()`.
- Mocking the module under test.
- Sharing mutable state between tests (`let` in the `describe` scope without reset).
- Waiting on real time (`await new Promise(r => setTimeout(r, 100))`).
- Huge DOM or JSON snapshot — breaks on irrelevant changes.
- Importing Server Actions through the module barrel (`@/modules/auth`) in **Client Component** tests — the barrel drags `server-only` into the graph. Use `@/app/(auth)/login/actions` (route shell) instead. For server tests, importing from the barrel or directly from `server/` is safe.

## Detailed references

Load as the task requires:

- `references/setup.md` — `vitest.config.ts`, `@/` aliases, `environmentMatchGlobs`, scripts in `package.json`, Husky integration, `server-only` stub.
- `references/mocks.md` — recipes for Supabase, Inngest, Resend, Twilio, fetch, timers, and env.
- `references/server-actions.md` — testing Server Actions, Route Handlers, and Zod validation at the boundaries.
- `references/hooks-components.md` — `renderHook`, Testing Library, `userEvent`, RSC vs Client.

## Templates

- `assets/vitest.config.ts` — base configuration ready to copy (already aligned with the `src/__tests__/unit/` structure).
- `assets/example.test.ts` — AAA skeleton with mocks cleaned per test.
