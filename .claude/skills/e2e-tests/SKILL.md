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

## Stack e arquitetura de teste

| Camada | Ferramenta | Função |
|---|---|---|
| Driver de browser | `@playwright/test` | Chromium/Firefox/WebKit, web-first assertions, auto-wait |
| App sob teste | Next.js via `webServer` da config | `npm run build && npm run start` em porta dedicada |
| Banco | `@testcontainers/postgresql` (`supabase/postgres`) | Container Postgres com migrations Drizzle aplicadas |
| Auth | `auth.setup.ts` que faz signin programático e salva `storageState` | Reutilizado por todos os testes via projeto dependente |
| Integrações externas (Twilio, Asaas, Receita Saúde) | `page.route()` no fixture | Interceptadas antes de sair do navegador |
| Dados de teste | Helpers Node que escrevem direto no DB via Drizzle | Rápido, fora do navegador |

## Decisão: Testcontainers vs `supabase start` para E2E

| Critério | Testcontainers Postgres-only | `supabase start` (CLI completa) |
|---|---|---|
| Auth (gotrue) real | Não — simulado via insert em `auth.users` + cookie | Sim |
| Storage real | Não — mockado em `page.route()` | Sim |
| Velocidade de boot no CI | Rápido (~5–10s) | Lento (~30–60s) |
| Fidelidade | Média | Alta |
| Isolamento por run | Excelente (`.withReuse()`) | Compartilhado |

**Default desta skill:** Testcontainers Postgres + auth simulada via cookie (`supabase.auth.token`). Use `supabase start` apenas para uma suite de smoke separada que precisa testar o fluxo de signup/recuperação de senha real.

## Quality gates

Antes de declarar a tarefa concluída:

```bash
docker info >/dev/null            # Docker rodando
npx playwright install --with-deps chromium  # primeira vez no ambiente
npm run test:e2e                  # roda toda a suite E2E
npm run lint && npm run typecheck
```

Se Docker ou os browsers não estiverem disponíveis, **declare explicitamente** — não pule silenciosamente.

## Estrutura de arquivos

```
e2e/
  playwright.config.ts
  global-setup.ts                 # sobe container, aplica migrations, cria seed users
  auth.setup.ts                   # signin programático → storageState
  fixtures/
    test-base.ts                  # `test` extendido (DB helper, network mocks)
  helpers/
    db.ts                         # Drizzle conectado ao container, factories
    network.ts                    # presets de page.route()
  flows/
    auth.spec.ts
    paciente.spec.ts
    agendamento.spec.ts
    cobranca-pix.spec.ts
    telepsicologia.spec.ts
```

Sufixo `.spec.ts` evita conflito com `.test.ts`/`.int.test.ts` do Vitest.

## Princípios

1. **Fluxos do usuário, não páginas**: um teste cobre uma jornada (`agendar consulta`), não uma tela isolada.
2. **Locator semântico**: `getByRole`, `getByLabel`, `getByText`. **Nunca** seletor CSS frágil. `data-testid` só como último recurso e sempre estável.
3. **Sem `sleep`/`waitForTimeout`**: use auto-wait dos locators (`expect(...).toBeVisible()`) ou `page.waitForURL`/`page.waitForResponse` quando precisar de evento específico.
4. **Auth uma vez por worker**: setup project gera `storageState`; cada teste começa logado em <100ms.
5. **Dados via DB direto**, não pela UI: criar paciente para um teste de agendamento? `db.insert(pacientes)`. Cadastrar pelo formulário em todos os testes desperdiça tempo e amplia superfície de falha.
6. **Mocke integrações externas no `page.route()`**: Twilio, Asaas, Receita Saúde. Banco continua real.
7. **Isolamento por teste**: TRUNCATE no `beforeEach` do fixture (mesmo padrão da skill de integração), exceto seed users que servem ao `storageState`.
8. **Falhe rápido e ruidoso**: sem `try/catch` que esconde erros; trace + screenshot + video automáticos no fail.

## Exemplo canônico

```ts
// e2e/flows/agendamento.spec.ts
import { test, expect } from '../fixtures/test-base';
import { createPaciente } from '../helpers/db';

test.describe('Agendamento de consulta', () => {
  test('psicólogo agenda consulta e vê na agenda', async ({ page, dr }) => {
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

## Referências detalhadas

Carregue conforme a tarefa exigir:

- `references/setup.md` — `playwright.config.ts`, `webServer`, projects, dependências entre projects, integração com Testcontainers via `globalSetup`.
- `references/auth-storage-state.md` — `auth.setup.ts`, signin programático para Supabase Auth simulado, worker-scoped storage para paralelismo.
- `references/locators-interacoes.md` — hierarquia de locators, espera automática, `expect.poll`, padrões de form e tabela.
- `references/network-mocking.md` — `page.route()` para Twilio, Asaas, Gemini, Receita Saúde; verificar requisições; `routeFromHAR` para fluxos complexos.
- `references/test-data.md` — factories que escrevem direto no DB via Drizzle, isolamento entre testes, seed users imutáveis.
- `references/fluxos-criticos-hubrityp.md` — lista priorizada de jornadas que devem ter E2E e que não devem.
- `references/ci-artifacts.md` — trace viewer, screenshots, videos, retries, sharding em CI.

## Templates

- `assets/playwright.config.ts` — config completa com `webServer`, projects (setup → chromium), retries e artifacts.
- `assets/global-setup.ts` — sobe container, aplica migrations, cria seed users.
- `assets/auth.setup.ts` — signin programático → `storageState`.
- `assets/db-helpers.ts` — cliente Drizzle e factories.
- `assets/test-base.ts` — fixture estendido com `dr` (psicólogo logado) e mocks de rede padrão.
- `assets/exemplo.e2e.spec.ts` — esqueleto de spec pronto.
