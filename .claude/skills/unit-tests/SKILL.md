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
- Queries reais contra Supabase, RLS, migrations → use **testes de integração** contra Supabase local via Docker.
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
npm run test:unit          # Vitest (pasta unit/, ambiente node ou jsdom conforme suite)
npm run lint
npm run typecheck
```

Se algum script estiver faltando no `package.json`, adicione (não pule). Não use `--no-verify` em commits.

## Estrutura de arquivos

Co-localize testes unitários ao lado do arquivo testado, com sufixo `.test.ts` / `.test.tsx`. Reserve `__tests__/` apenas para fixtures e helpers compartilhados.

```
lib/
  cpf/
    validate.ts
    validate.test.ts
app/
  (app)/agenda/
    actions.ts
    actions.test.ts
__tests__/
  fixtures/
  helpers/
```

Ambiente por suíte (declarado no topo do arquivo):

```ts
// @vitest-environment jsdom   ← apenas para hooks/componentes que usam DOM
// @vitest-environment node    ← padrão para lógica/server
```

## Escolha de mock por situação

| Situação | Ferramenta | Por quê |
|---|---|---|
| Substituir módulo inteiro (ex.: cliente Supabase, Resend) | `vi.mock('@/lib/supabase/server', () => ({...}))` | Hoisted; evita execução real do módulo |
| Espionar método de objeto existente preservando original | `vi.spyOn(obj, 'metodo')` | Restaurável com `mockRestore()` |
| Função descartável passada como argumento | `vi.fn()` | Captura chamadas e retorno |
| Tempo / cron / setTimeout | `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` | Controle determinístico |
| Variáveis de ambiente | `vi.stubEnv('NEXT_PUBLIC_FOO', 'bar')` | Restaurado por `vi.unstubAllEnvs()` |
| `fetch` global | `vi.stubGlobal('fetch', vi.fn())` | Restaurado por `vi.unstubAllGlobals()` |

Sempre limpar entre testes (configurar uma vez no `vitest.config.ts` via `clearMocks`, `restoreMocks`, `unstubGlobals`, `unstubEnvs`).

## Exemplo canônico (lógica pura + Zod)

```ts
// lib/cpf/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateCpf } from './validate';

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
// app/(app)/pacientes/actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { criarPaciente } from './actions';

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

## Antipadrões a evitar

- Testar implementação interna (nomes de variáveis privadas, ordem de chamadas irrelevante).
- `expect(true).toBe(true)` ou testes que sempre passam.
- `try/catch` engolindo a exceção em vez de `await expect(...).rejects.toThrow()`.
- Mockar o módulo sob teste.
- Compartilhar estado mutável entre testes (`let` no escopo do `describe` sem reset).
- Esperar tempo real (`await new Promise(r => setTimeout(r, 100))`).
- Snapshot gigante de DOM ou JSON — quebra por mudanças irrelevantes.

## Referências detalhadas

Carregue conforme a tarefa exigir:

- `references/setup.md` — `vitest.config.ts`, aliases `@/`, jsdom vs node, scripts no `package.json`, integração com Husky.
- `references/mocks.md` — receitas para Supabase, Inngest, Resend, Twilio, fetch, timers e env.
- `references/server-actions.md` — testando Server Actions, Route Handlers e validação Zod nas fronteiras.
- `references/hooks-componentes.md` — `renderHook`, Testing Library, `userEvent`, RSC vs Client.

## Templates

- `assets/vitest.config.ts` — configuração base pronta para copiar.
- `assets/exemplo.test.ts` — esqueleto AAA com mocks limpos por teste.
