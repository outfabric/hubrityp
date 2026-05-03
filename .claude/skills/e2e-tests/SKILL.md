---
name: e2e-tests
description: Boas práticas para escrever testes E2E em TypeScript + Next.js usando Playwright (com Testcontainers Postgres quando o teste exige banco real). Use sempre que precisar criar, revisar ou refatorar testes end-to-end de fluxo de usuário — autenticação, CRUD pelo navegador, agendamento, lembretes WhatsApp, geração de receita, cobrança/PIX, telepsicologia, prontuário — ou quando o usuário pedir para "criar teste E2E", "smoke test", "teste de fluxo", "testar pelo navegador", configurar Playwright, lidar com `storageState`/auth reuso, mockar APIs externas via `page.route()`, ou cobrir um fluxo crítico antes de PR.
---

# Testes E2E (Playwright + Testcontainers)

Skill para o subagent `fullstack-developer` produzir testes E2E que validam **o fluxo do usuário no navegador**, contra a aplicação Next.js real e Postgres real. Foco em **fluxos críticos** do HubrityP, não em cobertura ampla — E2E é caro, mantenha enxuto.

## Escopo

Use Playwright para validar:

- **Fluxos críticos** ponta a ponta: cadastro/login, CRUD de paciente, agendamento, lembrete WhatsApp, receita digital, cobrança PIX, sessão de telepsicologia, prontuário (lista no `references/fluxos-criticos-hubrityp.md`).
- Comportamentos que dependem do **navegador real**: redirecionamentos, sessão, cookies, navegação entre rotas, hidratação de RSC.
- Smoke tests pós-deploy (subset rápido em produção/staging com auth de teste).

Não use E2E para:

- Lógica pura, validators, helpers → **`unit-tests`**.
- Server Actions/Route Handlers contra DB → **`integration-tests`**.
- Validação isolada de RLS ou queries Drizzle → **`integration-tests`**.

A pirâmide vale: muitos unitários, vários de integração, **poucos E2E** (~1 por jornada crítica).

## Duas suítes E2E (e dois Playwright configs)

O HubrityP roda E2E em **duas suítes separadas**, cada uma com seu próprio config:

| Suíte | Config | Diretório de testes | Auth | Quando |
|---|---|---|---|---|
| **seeded** (`@<dominio>` tags) | `playwright.seeded.config.ts` | `src/__tests__/e2e/seeded/` | Mock GoTrue + cookie via `storageState` (programático) | Default — toda jornada crítica |
| **real** (`@auth-real`) | `playwright.real.config.ts` | `src/__tests__/e2e/real/` | Stack Supabase real (`supabase start`) | Smoke do fluxo de auth real (signup/refresh/logout) — uma vez por release |

Comandos:

```bash
npm run test:e2e:seeded    # suíte default — Playwright + Testcontainers Postgres + mock GoTrue
npm run test:e2e:real      # exige `npx supabase start` rodando; valida o caminho real de auth
```

> **Conflito de porta**: as duas suítes não rodam em paralelo. Ambas precisam de `127.0.0.1:54321` (porta do Supabase local que o `next build` inlina em `NEXT_PUBLIC_SUPABASE_URL` no edge bundle). Pare uma antes de subir a outra. Ver bloco "Notas críticas" abaixo.

## Stack e arquitetura de teste

| Camada | Ferramenta | Função |
|---|---|---|
| Driver de browser | `@playwright/test` | Chromium/Firefox/WebKit, web-first assertions, auto-wait |
| App sob teste | Next.js via `webServer` da config | `npm run build && npm run start` em porta dedicada |
| Banco | `@testcontainers/postgresql` (`postgres:16-alpine` no HubrityP) | Container Postgres com migrations Drizzle aplicadas + bootstrap mínimo do schema `auth` |
| Container compartilhado | `src/__tests__/e2e/_shared/postgres-container.ts` | Mesmo módulo é usado pelo runner de integração — fonte única de boot |
| Auth (suíte seeded) | Mock GoTrue + `auth.setup.ts` que faz signin programático e salva `storageState` | Reutilizado por todos os testes via projeto dependente |
| Auth (suíte real) | `supabase start` + cookies emitidos pelo GoTrue real | Sem `storageState` global — cada teste opera no DB do `supabase start` |
| Integrações externas (Twilio, Asaas, Receita Saúde) | `page.route()` no fixture | Interceptadas antes de sair do navegador |
| Dados de teste | Helpers Node que escrevem direto no DB via Drizzle | Rápido, fora do navegador |

## Decisão: Testcontainers vs `supabase start` para E2E

| Critério | Testcontainers Postgres-only (suíte seeded) | `supabase start` (suíte real) |
|---|---|---|
| Auth (gotrue) real | Não — simulado por mock GoTrue + cookie | Sim |
| Storage real | Não — mockado em `page.route()` | Sim |
| Velocidade de boot no CI | Rápido (~5–10s) | Lento (~30–60s) |
| Fidelidade | Média | Alta |
| Isolamento por run | Excelente (`.withReuse()`) | Compartilhado |

**Default desta skill:** suíte seeded (Testcontainers Postgres + mock GoTrue + cookie via `@supabase/ssr`). A suíte real fica reservada para uma única spec de smoke por release.

## Quality gates

Antes de declarar a tarefa concluída:

```bash
docker info >/dev/null                          # Docker rodando
npx playwright install --with-deps chromium    # primeira vez no ambiente
npm run test:e2e:seeded                         # suíte default
# E quando alterar fluxo de auth real:
# npx supabase start && npm run test:e2e:real && npx supabase stop
npm run lint && npm run typecheck
```

Se Docker ou os browsers não estiverem disponíveis, **declare explicitamente** — não pule silenciosamente.

## Estrutura de arquivos

```
playwright.seeded.config.ts                            # config da suíte default
playwright.real.config.ts                              # config da suíte @auth-real
src/
  __tests__/
    e2e/
      _shared/
        postgres-container.ts                          # bootPostgres + applyMigrations (compartilhado com integration)
      seeded/
        setup/
          start-server.ts                              # webServer wrapper: boot Postgres + mock GoTrue + spawn `next start`
          global-setup.ts                              # Playwright globalSetup: seed users + dados base
          global-teardown.ts
          auth.setup.ts                                # signin programático -> storageState (.auth/state.json)
          seed-state.ts                                # serializa metadados para o auth.setup.ts ler
          mock-gotrue.ts                               # servidor HTTP que emula o GoTrue
          .auth/                                       # gerado em runtime (gitignored): state.json, seed-state.json
        tags.json                                      # mapping arquivo->tag de domínio
        auth.spec.ts                                   # specs do domínio
        smoke.spec.ts
        ...
      real/
        setup/
          global-setup.ts
          global-teardown.ts
          credentials.ts
        auth.spec.ts                                   # @auth-real, contra `supabase start`
```

Sufixo `.spec.ts` é o padrão do Playwright (não confunde com `.test.ts` / `.int.test.ts` do Vitest).

## Princípios

1. **Fluxos do usuário, não páginas**: um teste cobre uma jornada (`agendar consulta`), não uma tela isolada.
2. **Locator semântico**: `getByRole`, `getByLabel`, `getByText`. **Nunca** seletor CSS frágil. `data-testid` só como último recurso e sempre estável.
3. **Sem `sleep`/`waitForTimeout`**: use auto-wait dos locators (`expect(...).toBeVisible()`) ou `page.waitForURL`/`page.waitForResponse` quando precisar de evento específico.
4. **Auth uma vez por worker**: o setup project gera `storageState` em `src/__tests__/e2e/seeded/setup/.auth/state.json`; cada teste começa logado em <100ms via `test.use({ storageState: STORAGE_STATE_PATH })`.
5. **Dados via DB direto**, não pela UI: criar paciente para um teste de agendamento? `db.insert(pacientes)`. Cadastrar pelo formulário em todos os testes desperdiça tempo e amplia superfície de falha.
6. **Mocke integrações externas no `page.route()`**: Twilio, Asaas, Receita Saúde. Banco continua real.
7. **Isolamento por teste**: TRUNCATE no `beforeEach` do fixture (mesmo padrão da skill de integração), exceto seed users que servem ao `storageState`.
8. **Falhe rápido e ruidoso**: sem `try/catch` que esconde erros; trace + screenshot + video automáticos no fail.

## Exemplo canônico

```ts
// src/__tests__/e2e/seeded/agendamento.spec.ts
import { expect, test } from '@playwright/test';
import { STORAGE_STATE_PATH } from './setup/seed-state';
import { createPaciente } from './helpers/db';

test.use({ storageState: STORAGE_STATE_PATH });

test.describe('@agenda agendamento de consulta', () => {
  test('psicólogo agenda consulta e vê na agenda', async ({ page }) => {
    const dr = { id: '00000000-0000-4000-8000-000000000001' };
    await createPaciente({ psicologoId: dr.id, nome: 'Maria Silva' });

    await page.goto('/agenda');
    await page.getByRole('button', { name: /nova consulta/i }).click();

    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option', { name: 'Maria Silva' }).click();
    await page.getByLabel(/data/i).fill('2026-06-01');
    await page.getByLabel(/horário/i).fill('14:00');
    await page.getByRole('button', { name: /confirmar/i }).click();

    await expect(page.getByText(/consulta agendada/i)).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Maria Silva' })
    ).toBeVisible();
  });
});
```

## Antipadrões

- Testar tudo: cada bug ganha um E2E. Resultado: suite de 30min no CI. Bug → unit + integration; jornada → E2E.
- `page.waitForTimeout(2000)` para "esperar a página carregar".
- Selectors CSS (`page.locator('.btn-primary > span')`).
- Login via UI em todo teste (lento e flaky).
- Compartilhar paciente/agendamento entre testes (`test.describe.serial` é code smell — sinaliza dependência mal modelada).
- Gravar `data-testid` em tudo "preventivamente" — só onde role/label não bastam.
- Snapshots de screenshots para validar conteúdo (use assertions de texto/role; reserve screenshots a regressão visual com `toHaveScreenshot()` em casos calibrados).
- Chamar Twilio/Asaas/Receita Saúde de verdade — **um teste flaky no CI vira hábito de re-rodar até passar**.
- Mover boot do Postgres ou de mock externo para `globalSetup` — Playwright sobe `webServer` ANTES de `globalSetup`, então env de runtime do Next vai estar incompleto. Faça boot dentro do wrapper `start-server.ts` (ver "Notas críticas").

## Notas críticas (pegadinhas reais)

> Estas pegadinhas vivem aqui porque já queimaram o time uma vez. Antes de mexer em `playwright.seeded.config.ts`, `playwright.real.config.ts`, `start-server.ts` ou qualquer coisa que envolva `supabase.auth.getUser()` no servidor, releia.

### `NEXT_PUBLIC_*` é inlinado no edge runtime em build time

`src/middleware.ts` roda no edge runtime, e o Next inlina o valor de `NEXT_PUBLIC_SUPABASE_URL` no bundle no momento do `next build`. Não dá para sobrescrever via `webServer.env` em runtime — o middleware sempre vai bater no host/porta que o build viu. Por isso o mock GoTrue do suite seeded precisa ouvir na **mesma porta hardcoded** que o build conhece (`127.0.0.1:54321`, idem ao `supabase start`). O helper canônico em `src/__tests__/e2e/seeded/setup/mock-gotrue.ts` (`startMockGotrue({ port })`) aceita override mas defaulta para `54321`. Consequência: as duas suítes (seeded e real) **não rodam concorrentemente** — disputam a porta.

### Playwright sobe `webServer` ANTES de `globalSetup`

Verificável em `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`. Qualquer coisa que `globalSetup` escreve em `process.env` (URL dinâmica do Testcontainers Postgres, porta efêmera de mock) é invisível ao Next.js spawnado — `webServer.env` é capturado no config-load. Workaround canônico: `src/__tests__/e2e/seeded/setup/start-server.ts` faz o boot dinâmico (Postgres + mock GoTrue) e só então `exec`a `next start`, garantindo env completo no momento certo. Esse pattern reusável vale para qualquer suite futuro que precise de recursos efêmeros antes do servidor.

### `playwright.real.config.ts` chama `execSync` no top-level

Mesmo problema da seção anterior em outra fantasia. Como `webServer.env` é capturado em config-load e o suite `@auth-real` depende de URLs/keys que só existem depois de `npx supabase start`, `playwright.real.config.ts` faz `execSync('npx supabase status -o json')` sincronamente no top-level — _não_ em `globalSetup`. **Não tente "consertar" movendo para `globalSetup`**: vai parecer mais limpo e quebrar como descrito acima, porque o Next spawnado não enxerga as vars.

## Referências detalhadas

Carregue conforme a tarefa exigir:

- `references/setup.md` — `playwright.seeded.config.ts`, `playwright.real.config.ts`, `webServer`, projects, dependências entre projects, integração com Testcontainers via `_shared/postgres-container.ts`.
- `references/auth-storage-state.md` — `auth.setup.ts`, signin programático com `@supabase/ssr` contra mock GoTrue, scope de cookies, suíte real vs seeded.
- `references/locators-interacoes.md` — hierarquia de locators, espera automática, `expect.poll`, padrões de form e tabela.
- `references/network-mocking.md` — `page.route()` para Twilio, Asaas, Gemini, Receita Saúde; verificar requisições; `routeFromHAR` para fluxos complexos.
- `references/test-data.md` — factories que escrevem direto no DB via Drizzle, isolamento entre testes, seed users imutáveis.
- `references/fluxos-criticos-hubrityp.md` — lista priorizada de jornadas que devem ter E2E e que não devem.
- `references/ci-artifacts.md` — trace viewer, screenshots, videos, retries, sharding em CI.

## Templates

- `assets/playwright.config.ts` — **legado**: o HubrityP usa `playwright.seeded.config.ts` + `playwright.real.config.ts` na raiz do repo. Use os configs reais como referência ao invés desse asset.
- `assets/global-setup.ts` — sobe container, aplica migrations, cria seed users.
- `assets/auth.setup.ts` — signin programático → `storageState`.
- `assets/db-helpers.ts` — cliente Drizzle e factories.
- `assets/test-base.ts` — fixture estendido com `dr` (psicólogo logado) e mocks de rede padrão.
- `assets/exemplo.e2e.spec.ts` — esqueleto de spec pronto.
