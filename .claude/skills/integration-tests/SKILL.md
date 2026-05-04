---
name: integration-tests
description: Boas práticas para escrever testes de integração em TypeScript + Next.js com Vitest, React Testing Library e Testcontainers (Postgres real em container Docker, com migrations Drizzle e RLS do Supabase aplicados). Use sempre que precisar criar, revisar ou refatorar testes que cruzam fronteiras reais — Server Actions ou Route Handlers contra Postgres real, queries Drizzle contra schema real, validação de policies RLS, ou fluxos de UI integrados (RTL com providers reais e MSW para HTTP). Aplica-se quando o usuário pedir para "testar contra banco real", "validar RLS", "teste de integração", "mock de rede via MSW", "testar Server Action de ponta a ponta", configurar Testcontainers, ou quando uma feature nova exige cobertura de integração antes do PR.
---

# Testes de integração (Vitest + RTL + Testcontainers)

Skill para o subagent `fullstack-developer` produzir testes de integração no HubrityP. Foco: **exercitar fronteiras reais** (Postgres com schema/RLS aplicados, Server Actions chamando Drizzle real) e **dependências externas isoladas** (HTTP via MSW, filas e e-mail mockados nas bordas).

## Escopo

Use este nível de teste para validar:

- Server Actions e Route Handlers contra Postgres real (Drizzle + migrations aplicadas).
- Queries Drizzle e composição de joins/transactions.
- **Políticas RLS do Supabase** com `auth.uid()` setado por JWT claims simulado.
- Fluxos de UI integrados em RTL (providers reais: TanStack Query, Theme, Toaster), com HTTP interceptado por MSW.
- Webhooks recebidos (Twilio, Asaas, Receita Saúde) — Route Handler real, payload real, DB real, integrações de saída mockadas.

Não use este nível para:

- Lógica pura, validators, helpers → **Vitest unitário** (skill `unit-tests`).
- Fluxo navegacional completo no browser, captura de screenshots, multi-tab → **Playwright E2E**.
- Performance/carga → ferramenta dedicada, fora do escopo.

## Por que Testcontainers (e não só Supabase CLI local)

| Critério | `supabase start` (CLI) | Testcontainers (`@testcontainers/postgresql`) |
|---|---|---|
| Isolamento entre arquivos de teste | Compartilhado, manual | Container por suite (ou `globalSetup`) |
| Velocidade no CI | Bom (1 boot) | Muito bom com `reuse` ligado |
| Fidelidade ao Postgres do Supabase | Alta (mesma stack) | Alta com imagem `supabase/postgres` |
| Necessário para dev local diário | Sim — não substituir | Não — é só para testes |
| Paralelismo seguro | Limitado | Sim, via schema-por-suite |

**Regra prática:** Testcontainers para a suíte de integração (CI e dev). `supabase start` permanece como ambiente de desenvolvimento (UI Studio, Auth, Storage, Realtime). Os dois coexistem.

## Estrutura recomendada

Todos os testes vivem **centralizados** sob `src/__tests__/`. Integração usa o sufixo `.int.test.ts` para o filtro do Vitest pegar só essa camada.

```
vitest.config.ts                                  # unit (rápido, sem container)
vitest.integration.config.ts                      # integration (globalSetup + container)
src/
  __tests__/
    integration/
      setup/
        global-setup.ts                           # Vitest globalSetup: chama bootPostgres + applyMigrations
        db.ts                                     # client Drizzle / openClient() para o container
        run-as-user.ts                            # helper RLS: SET LOCAL role + jwt.claims
        run-as-service.ts                         # bypassa RLS para preparar dados
        msw-server.ts                             # servidor MSW para mockar HTTP externo
      factories/
        health-pings.ts                           # factory tipada do schema Drizzle
      api-health.int.test.ts                     # exemplo: Route Handler contra DB real
      auth-signin.int.test.ts                    # exemplo: Server Action de domínio
      app/(app)/pacientes/                        # mirror do source quando o teste é de uma rota
        actions.int.test.ts
    e2e/
      _shared/
        postgres-container.ts                     # CONTAINER COMPARTILHADO entre integration e seeded e2e
      seeded/...
      real/...
    stubs/
      server-only.ts                              # no-op para imports de `server-only`
src/
  modules/<domain>/server/...                     # Server Actions sob teste
  shared/db/schema/...                            # schema Drizzle alvo das migrations
```

> **Container Postgres compartilhado**: `src/__tests__/e2e/_shared/postgres-container.ts` é o módulo único que sobe Postgres + bootstrap do schema `auth` + roda migrations Drizzle. Tanto `vitest.integration.config.ts` (via `src/__tests__/integration/setup/global-setup.ts`) quanto o seeded e2e (via `src/__tests__/e2e/seeded/setup/start-server.ts`) importam dali. Não duplique: se precisar mexer no boot, mexa lá.

## Workflow padrão (fluxo enxuto)

1. **Identifique a fronteira sob teste**: Server Action? Route Handler? Query? Componente integrado?
2. **Suba o ambiente uma vez** via `globalSetup`: container Postgres com `supabase/postgres` (ou `postgres:16-alpine` + bootstrap manual do schema `auth`, como o `_shared/postgres-container.ts` faz hoje), migrations Drizzle aplicadas, extensões habilitadas.
3. **Isole dados entre testes** com a estratégia escolhida (ver `references/data-isolation.md`). Default: `TRUNCATE` em `beforeEach` das tabelas tocadas — rápido e previsível.
4. **Mocke apenas integrações externas** (Twilio, Resend, Receita Saúde). Banco é real.
5. **Para RLS**, conecte como `authenticated` e seta `request.jwt.claims` no nível da sessão. Veja `references/rls-supabase.md`.
6. **Para UI integrada**, use RTL com providers reais e MSW como camada de rede. Veja `references/ui-integration-rtl.md`.

## Princípios

1. **Banco é a fonte da verdade**: nunca mocke Drizzle ou o cliente Postgres em testes de integração — derrota o propósito.
2. **Determinismo > velocidade**: prefira `TRUNCATE` explícito a depender de ordem de execução.
3. **Cobertura de RLS é obrigatória** para qualquer Server Action que toque tabela com policy. Teste pelo menos: dono lê, dono escreve, **outro psicólogo NÃO lê**, **outro psicólogo NÃO escreve**.
4. **MSW na rede, não monkeypatch**: substitua `fetch` por handler MSW; mantém o código sob teste idêntico ao de produção.
5. **Factories tipadas** (`createPaciente()`, `createAgendamento()`) reutilizáveis em todas as suítes — derive os tipos do schema Drizzle (`InferInsertModel`, `NewHealthPing`, etc.).
6. **Falha por motivo claro**: se um teste de RLS quebra, deve ser óbvio se foi a query ou a policy.
7. **Não logue PII em saída de teste**: configure Pino com level `silent` no setup global.

## Exemplo canônico (Server Action contra DB real, com RLS)

```ts
// src/__tests__/integration/app/(app)/pacientes/actions.int.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/__tests__/integration/setup/db';
import { runAsUser } from '@/__tests__/integration/setup/run-as-user';
import { truncateAll } from '@/__tests__/integration/setup/run-as-service';
import { criarPaciente, listarPacientes } from '@/modules/pacientes/server/actions';
import { createPsicologo } from '@/__tests__/integration/factories/psicologo';

describe('pacientes — integração', () => {
  beforeEach(() => truncateAll(db, ['pacientes', 'psicologos']));

  it('psicólogo só enxerga seus próprios pacientes (RLS)', async () => {
    const dr_a = await createPsicologo();
    const dr_b = await createPsicologo();

    await runAsUser(dr_a.id, () =>
      criarPaciente({ nome: 'Maria', cpf: '529.982.247-25' })
    );

    const pacientesDoB = await runAsUser(dr_b.id, () => listarPacientes());

    expect(pacientesDoB).toEqual([]);
  });
});
```

> **Importações**: o alias `@/*` resolve para `src/*` (post-`reorganize-folder-structure`). O Server Action sob teste vem do módulo (`@/modules/pacientes/server/actions`), não do route shell em `@/app/(app)/.../actions` — o shell é apenas um wrapper `'use server'` que delega.

## Antipadrões

- Mockar `db` ou `drizzle` em teste de integração.
- Compartilhar dados entre testes ("o teste anterior cria o paciente que o próximo usa").
- Usar `process.env.DATABASE_URL` apontando para Supabase staging/produção.
- Esquecer de `await container.stop()` no teardown — vaza container entre runs.
- Testar UI integrada chamando rede real (sem MSW) — flaky no CI.
- Snapshot de DOM gigante — quebra por mudança irrelevante de Tailwind.
- Validar RLS testando "se a policy SQL existe" em vez de provar o **comportamento**: outro usuário recebe lista vazia, ou erro `42501`.
- Importar do barrel do módulo (`@/modules/auth`) dentro de uma Client Component — arrasta `server-only` pro bundle. Para Server Actions usadas em forms, importe do route shell (`@/app/(auth)/login/actions`); para uso server-side, o barrel é OK.

## Referências detalhadas

Carregue conforme a tarefa exigir:

- `references/testcontainers-setup.md` — `globalSetup` apoiado em `@/__tests__/e2e/_shared/postgres-container`, imagem do container, bootstrap do schema `auth`, migrations Drizzle (`src/shared/db/migrations`), reuse de container, env de teste.
- `references/data-isolation.md` — comparativo: TRUNCATE vs transação com rollback vs schema-por-suite. Quando usar cada um.
- `references/rls-supabase.md` — receitas para conectar como `authenticated`, setar `request.jwt.claims`, helper `runAsUser`, casos obrigatórios.
- `references/server-actions-rotas.md` — testar Server Actions e Route Handlers (webhooks) contra DB real, mocks de fronteiras externas.
- `references/ui-integration-rtl.md` — RTL com providers reais, MSW para rede, integração com Server Actions.
- `references/factories.md` — fábricas tipadas a partir do schema Drizzle, geração de dados realistas.

## Templates

- `assets/vitest.integration.config.ts` — config separada da unit, com `globalSetup`, timeout maior e `pool: 'forks'`.
- `assets/global-setup.ts` — chama `bootPostgres()` + `applyMigrations()` do módulo compartilhado e expõe `DATABASE_URL` via `process.env`.
- `assets/db.ts` — cliente Drizzle único reutilizado nos testes.
- `assets/rls.ts` — helpers `runAsUser`, `truncateAll`.
- `assets/msw-server.ts` — bootstrap MSW para Node (test env).
- `assets/exemplo.integration.test.ts` — esqueleto pronto.
