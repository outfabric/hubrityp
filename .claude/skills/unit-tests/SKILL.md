---
name: unit-tests
description: Boas práticas para escrever testes unitários com Vitest em projetos TypeScript + Next.js (App Router). Use sempre que precisar criar, revisar ou refatorar testes unitários — para lógica pura, validators Zod, helpers, hooks React, Server Actions, Route Handlers ou utilitários — em projetos Next.js com TypeScript. Aplica-se também quando o usuário pedir para "adicionar testes", "escrever spec", "cobrir com testes", "mockar módulo", configurar Vitest, ou quando uma feature nova precisa de cobertura unitária antes de PR.
---

# Testes unitários com Vitest (Next.js + TypeScript)

Skill para o subagent `fullstack-developer` produzir testes unitários consistentes, rápidos e confiáveis no HubrityP. Mantenha o foco em **isolar a unidade**, validar **comportamento** (não implementação) e expressar a intenção via **nome do teste**.

## Quando usar Vitest (escopo unitário)

Use Vitest para o que cabe na pirâmide de testes como base:

- Funções puras, validators Zod, helpers de data/moeda/strings.
- Hooks React isolados (sem rede), reducers, stores Zustand.
- Lógica de Server Actions e Route Handlers **com dependências mockadas** (Supabase, Inngest, Resend, Twilio).
- Mappers entre payloads externos e modelos internos.

Não use Vitest para:

- Fluxo end-to-end de UI → use **Playwright** (E2E).
- Queries reais contra Supabase, RLS, migrations → use **testes de integração** contra Postgres real via Docker (Testcontainers).
- Renderização visual/snapshot pesada → prefira asserções de comportamento.

## Princípios

1. **AAA explícito**: blocos visualmente separados de Arrange / Act / Assert. Uma asserção principal por teste; asserções auxiliares só se reforçam a mesma intenção.
2. **Nome descreve o comportamento**: `it('rejeita CPF com dígitos repetidos', ...)`. Nada de `it('test 1')` ou `it('works')`.
3. **Isole I/O**: nenhum teste unitário toca rede, banco, filesystem ou relógio real. Mocke nas fronteiras.
4. **Determinismo**: sem `Math.random`, `Date.now`, UUID v4 vivos. Use `vi.useFakeTimers()` e injete clocks/IDs.
5. **Sem lógica no teste**: nada de `if`, `for`, `switch` dentro de `it`. Se precisar repetir, use `it.each`.
6. **Falha por motivo claro**: a mensagem do `expect` deve dizer **o que** quebrou, não **onde**.
7. **Rápido**: testes unitários devem rodar em milissegundos. Suíte unitária inteira < 10s na máquina do dev.

## Quality gates do projeto

Antes de declarar a tarefa concluída:

```bash
npm run test:unit          # Vitest (suíte unitária centralizada em src/__tests__/unit)
npm run lint
npm run typecheck
```

Se algum script estiver faltando no `package.json`, adicione (não pule). Não use `--no-verify` em commits.

## Estrutura de arquivos

Testes unitários vivem **centralizados** em `src/__tests__/unit/`, com a árvore espelhando a árvore de `src/`. Sufixo é `.test.ts` para lógica/server e `.test.tsx` para componentes/hooks (jsdom).

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

> **Por que centralizado e não colocado**: decisão registrada na change `reorganize-folder-structure`. O custo é uma jornada extra do editor entre source e teste; o ganho é "todos os testes em um único glob" e nenhum `*.test.ts` perdido sob `src/`.

> **Helper de teste vs. teste do helper**: o helper `mock-gotrue.ts` mora em `src/__tests__/e2e/seeded/setup/` (é parte da infra de e2e), mas seu **teste unitário** mora em `src/__tests__/unit/e2e/seeded/setup/mock-gotrue.test.ts` (espelhando o caminho em `src/__tests__/`, não em `src/`). Esse é o padrão para testar arquivos que vivem fora de `src/<domain>` — espelhe o caminho real.

Ambiente por suíte (declarado no topo do arquivo, quando o default não bastar):

```ts
// @vitest-environment jsdom   ← apenas para hooks/componentes que usam DOM
// @vitest-environment node    ← padrão para lógica/server
```

O `vitest.config.ts` do projeto já configura `environmentMatchGlobs` para resolver `.test.tsx → jsdom` e `.test.ts → node` automaticamente.

## Escolha de mock por situação

| Situação | Ferramenta | Por quê |
|---|---|---|
| Substituir módulo inteiro (ex.: cliente Supabase, Resend) | `vi.mock('@/shared/supabase/server', () => ({...}))` | Hoisted; evita execução real do módulo |
| Espionar método de objeto existente preservando original | `vi.spyOn(obj, 'metodo')` | Restaurável com `mockRestore()` |
| Função descartável passada como argumento | `vi.fn()` | Captura chamadas e retorno |
| Tempo / cron / setTimeout | `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` | Controle determinístico |
| Variáveis de ambiente | `vi.stubEnv('NEXT_PUBLIC_FOO', 'bar')` | Restaurado por `vi.unstubAllEnvs()` |
| `fetch` global | `vi.stubGlobal('fetch', vi.fn())` | Restaurado por `vi.unstubAllGlobals()` |

Sempre limpar entre testes (configurar uma vez no `vitest.config.ts` via `clearMocks`, `restoreMocks`, `unstubGlobals`, `unstubEnvs`).

## Exemplo canônico (lógica pura + Zod)

```ts
// src/__tests__/unit/modules/pacientes/lib/cpf.test.ts
import { describe, it, expect } from 'vitest';
import { validateCpf } from '@/modules/pacientes/lib/cpf';

describe('validateCpf', () => {
  it.each([
    ['529.982.247-25', true],
    ['52998224725', true],
    ['111.111.111-11', false], // dígitos repetidos
    ['123.456.789-00', false], // dígito verificador inválido
    ['', false],
  ])('valida "%s" como %s', (input, expected) => {
    expect(validateCpf(input)).toBe(expected);
  });
});
```

## Exemplo canônico (Server Action com Supabase mockado)

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

  it('persiste paciente com nome normalizado', async () => {
    insert.mockResolvedValue({ data: { id: 'p_1' }, error: null });

    const result = await criarPaciente({ nome: '  Maria  Silva ', cpf: '529.982.247-25' });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ nome: 'Maria Silva' })
    );
    expect(result).toEqual({ ok: true, id: 'p_1' });
  });

  it('retorna erro acionável quando Supabase falha', async () => {
    insert.mockResolvedValue({ data: null, error: { message: 'duplicate' } });

    await expect(
      criarPaciente({ nome: 'X', cpf: '529.982.247-25' })
    ).rejects.toThrow(/duplicate/);
  });
});
```

> **Importações**: o alias `@/*` resolve para `src/*`. Nunca importe da árvore de testes (`@/__tests__/...`) dentro de código de produção. Para utilities compartilhadas entre testes, viva sob `src/__tests__/unit/_helpers/` (ou outro prefixo `_`).

## Antipadrões a evitar

- Testar implementação interna (nomes de variáveis privadas, ordem de chamadas irrelevante).
- `expect(true).toBe(true)` ou testes que sempre passam.
- `try/catch` engolindo a exceção em vez de `await expect(...).rejects.toThrow()`.
- Mockar o módulo sob teste.
- Compartilhar estado mutável entre testes (`let` no escopo do `describe` sem reset).
- Esperar tempo real (`await new Promise(r => setTimeout(r, 100))`).
- Snapshot gigante de DOM ou JSON — quebra por mudanças irrelevantes.
- Importar Server Actions por meio do barrel do módulo (`@/modules/auth`) em testes de **Client Component** — o barrel arrasta `server-only` no grafo. Use `@/app/(auth)/login/actions` (route shell) em vez disso. Para teste de servidor, importar do barrel ou direto do `server/` é seguro.

## Referências detalhadas

Carregue conforme a tarefa exigir:

- `references/setup.md` — `vitest.config.ts`, aliases `@/`, `environmentMatchGlobs`, scripts no `package.json`, integração com Husky, stub de `server-only`.
- `references/mocks.md` — receitas para Supabase, Inngest, Resend, Twilio, fetch, timers e env.
- `references/server-actions.md` — testando Server Actions, Route Handlers e validação Zod nas fronteiras.
- `references/hooks-componentes.md` — `renderHook`, Testing Library, `userEvent`, RSC vs Client.

## Templates

- `assets/vitest.config.ts` — configuração base pronta para copiar (já alinhada à estrutura `src/__tests__/unit/`).
- `assets/exemplo.test.ts` — esqueleto AAA com mocks limpos por teste.
