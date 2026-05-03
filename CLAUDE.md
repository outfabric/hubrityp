# CLAUDE.md

## Sobre o projeto

SaaS web para psicólogos autônomos brasileiros (consultório, online ou híbrido). Centraliza tarefas administrativas e clínicas hoje espalhadas em Google Agenda, WhatsApp, Word, Excel e PIX manual.

## Stack

- **TypeScript** + **Next.js 16+** (App Router)
- **Node.js 22 LTS**
- API via **Next.js API Routes / Server Actions** (sem backend separado)
- **Supabase** (Postgres + Auth + Storage), região `sa-east-1` (São Paulo)
- Deploy na **Vercel**, região `gru1` (São Paulo)
- Pacotes: **npm**

Latência e residência de dados em SP são requisitos — não sugerir outras regiões/provedores sem justificativa explícita.

## Diagrama de arquitetura

```
                        ┌──────────────────────────────────┐
                        │         USUÁRIOS                 │
                        │  Psicólogo (web/mobile browser)  │
                        │  Paciente (browser, WhatsApp)    │
                        └────────────┬─────────────────────┘
                                     │ HTTPS (TLS 1.3)
                                     ▼
            ┌────────────────────────────────────────────────────┐
            │         VERCEL (Frontend + API Routes)             │
            │                                                    │
            │  ┌─────────────────┐    ┌─────────────────────┐    │
            │  │   Next.js App   │    │  Next.js API Routes │    │
            │  │   (RSC + CSR)   │    │  + Server Actions   │    │
            │  │                 │    │                     │    │
            │  │  - Páginas      │    │  - CRUD             │    │
            │  │  - Componentes  │    │  - Auth             │    │
            │  │  - shadcn/ui    │    │  - Webhooks (recv)  │    │
            │  └─────────────────┘    └──────────┬──────────┘    │
            └─────────────────────────────────────┼──────────────┘
                                                  │
              ┌───────────────────────────────────┼───────────────────────────┐
              │                                   │                           │
              ▼                                   ▼                           ▼
    ┌─────────────────────┐          ┌─────────────────────┐       ┌──────────────────┐
    │     SUPABASE        │          │       INNGEST       │       │   APIs Externas  │
    │   (sa-east-1)       │          │   (Jobs + Cron)     │       │                  │
    │                     │          │                     │       │  - Twilio (WA)   │
    │  ┌──────────────┐   │          │  - WhatsApp envios  │       │  - Google Gemini │
    │  │ Postgres 15  │   │          │  - Gemini transc.   │       │                  │
    │  │ (RLS ativo)  │   │          │  - Receita Saúde    │       │  - Stream.io     │
    │  └──────────────┘   │          │  - PDF em lote      │       │  - Asaas         │
    │  ┌──────────────┐   │          │  - Backups          │       │  - e-CAC         │
    │  │  Auth        │   │          │  - Anonimização     │       │                  │
    │  │  - JWT       │   │          │  - Lembretes cron   │       │                  │
    │  │  - OAuth     │   │          │  - Reconciliação    │       │  - Receita Fed.  │
    │  └──────────────┘   │          │                     │       │                  │
    │  ┌──────────────┐   │          │      Plano Free     │       │  Webhooks volta  │
    │  │  Storage     │   │          └──────────┬──────────┘       │  para Vercel     │
    │  │  (S3-compat) │   │                     │                  └──────────────────┘
    │  └──────────────┘   │                     │
    │  ┌──────────────┐   │                     │
    │  │  Realtime    │◄──┼─────────────────────┘
    │  │  (WebSocket) │   │   (push de updates ao frontend
    │  └──────────────┘   │    quando job termina)
    └─────────────────────┘

```

## Rodando localmente

Sempre use **Docker Compose** para subir a aplicação localmente (Next.js + Supabase local + dependências). Não rodar `npm run dev` direto contra Supabase de produção/staging.

```bash
docker compose up        # subir tudo
docker compose down      # derrubar
```

## Padrões obrigatórios

- **Lint/format/type-check obrigatórios antes de finalizar qualquer mudança.** Rode, nesta ordem, e só dê a tarefa por concluída se os três passarem:

  ```bash
  npm run lint           # ESLint — falha o build se houver erro
  npm run format         # Prettier --write em todo o repo
  npm run typecheck      # tsc --noEmit em modo strict
  ```

  Atalho: `npm run check` roda os três em sequência. Se algum script ainda não existir no `package.json`, adicione-o em vez de pular a etapa.

- **Pre-commit**: Husky + lint-staged já rodam lint/format/type-check em arquivos staged. Não use `--no-verify`.
- **Server Actions** preferidas sobre Route Handlers para mutations vindas do app; Route Handlers para webhooks e integrações externas.
- **Supabase RLS sempre habilitado** em qualquer tabela nova — psicólogo só acessa dados dos próprios pacientes. Migrations sem policy RLS devem ser tratadas como bug. Schema e migrations vivem em `src/shared/db/schema/**` e `src/shared/db/migrations/`; o CLI de migration mora em `scripts/db-migrate.ts`.
- Dados sensíveis (prontuário, transcrições, áudios) seguem LGPD: nunca logar conteúdo, nunca enviar para serviços fora do Brasil sem aprovação explícita.
- **Consultas a docs de libs/frameworks/SDKs/CLIs/serviços usam o MCP Context7.** Sempre que precisar verificar API, sintaxe, configuração, migração de versão, setup ou comportamento de uma ferramenta/lib/pacote (Next.js, Supabase, Drizzle, shadcn/ui, Inngest, Tailwind, Zod, Twilio, Asaas, etc.), invoque `mcp__context7__resolve-library-id` seguido de `mcp__context7__query-docs` antes de escrever ou recomendar código — mesmo para libs que parecem familiares, já que o conhecimento de treinamento pode estar desatualizado. Prefira Context7 a web search para documentação. Não usar para refactor, lógica de negócio, code review ou conceitos gerais de programação.

## Workflow de change (dev-cycle)

Features novas e refactors não triviais seguem o ciclo:

1. **Planejar a change** com `/opsx:new` (passo a passo) ou `/opsx:ff` (gera todos os artefatos de uma vez). Resultado: `openspec/changes/<name>/` com `proposal.md`, `tasks.md`, `design.md` e `specs/`.
2. **Executar a change** com `/dev-cycle <name>`. O comando orquestra o ciclo fechado:
   - Cria um git worktree dedicado em `../hubrityp-<name>/` na branch `feature/<name>`.
   - Para cada task em ordem: invoca `fullstack-developer` → ele implementa, escreve testes (camadas indicadas pelas tags `[unit]` `[integration]` `[e2e]`), roda `npm run check`. Próxima task só inicia quando todos os gates da atual passam.
   - Quando todas as tasks estão `[x]`: invoca `code-reviewer` (loop dev↔reviewer com cap de 3 iterações) e depois decide se roda `qa-tester` via heurística (tags `[e2e]`, keywords UI em scenarios, paths tocados — skipa em changes backend-only; force com `/dev-cycle <name> --force-qa`). Quando QA roda, é loop dev↔QA com cap de 3. Cada fix pós-feedback executa re-validação escopada (lint+typecheck → unit full → integration `--related` → e2e `--grep`) com fallback para suítes completas em sinais amplos (schema/types/utils/auth/config/>10 arquivos).
   - Quando reviewer e QA (ou skip) estão limpos: **arquiva a change in-place** dentro do worktree — sync de delta specs → main specs, `mv openspec/changes/<name> → openspec/changes/archive/YYYY-MM-DD-<name>/`, e atualiza `docs/<cap>.md` para cada capability tocada. Em seguida cria commits semânticos per-task + 1 commit dedicado `chore(openspec): archive <name>`, faz push e abre PR via `gh`.
3. **Revisar e mergear o PR**. O archive já está no PR — não precisa rodar `/opsx:archive` separadamente. `/opsx:archive` segue disponível para uso ad-hoc fora do `/dev-cycle` (changes manuais, fixes, retries).

**Convenção de tags em `tasks.md`**: cada linha de task pode terminar em `[unit]`, `[integration]`, `[e2e]` (qualquer subconjunto). Default se ausente: `[unit]`. As tags determinam quais camadas de teste o `fullstack-developer` deve criar/atualizar para aquela task.

**Artefatos do orquestrador**: relatórios de review e QA são persistidos em `<worktree>/.dev-cycle/{review-N.md, qa-N.md, ...}` (gitignored). O worktree é descartável e pode ser removido com `git worktree remove ../hubrityp-<name>` após o merge do PR.

**Documentação completa**: `docs/dev-cycle.md`.

## Documentação técnica em `docs/`

Toda change do OpenSpec arquivada deve deixar atrás de si um arquivo de documentação técnica em `docs/<capability>.md` — **um doc por capability**, atualizado em vez de duplicado quando a capability evolui ao longo de várias changes. O objetivo é dar a desenvolvedores e agentes um mapa enxuto da capability sem precisar reler todo o histórico de specs e arquivos arquivados.

- **Quando**: gerado/atualizado automaticamente pelo step de archive do `/dev-cycle` (step 6.4 — equivalente inline do step de docs do `/opsx:archive`), depois do sync de specs e do `mv` para `openspec/changes/archive/`. Também rodado por `/opsx:archive` e `/opsx:bulk-archive` quando usados ad-hoc.
- **Granularidade**: 1 arquivo por capability presente em `openspec/changes/<name>/specs/`. Changes sem delta specs (ex.: docs-only) pulam o step.
- **Fonte da verdade**: o spec formal continua sendo `openspec/specs/<cap>/spec.md`. O `docs/<cap>.md` é o resumo legível com **propósito**, **onde mora o código** (paths reais), **superfície pública** (rotas/Server Actions/components/env vars), **comportamento e invariantes** (RLS, LGPD, contratos com integrações externas), **testes** (arquivos por camada) e **histórico de changes** (newest first, com link para `../openspec/changes/archive/<dated>/`).
- **Idioma**: prosa em pt-BR para ficar consistente com `docs/dev-cycle.md` e demais docs; identificadores de código, paths e comandos de shell em inglês.
- **Atualização**: quando o doc já existe, editar **in place** — refrescar seções obsoletas e prepender a nova entrada no histórico, preservando edições manuais (especialmente seções fora do template padrão).

Detalhes operacionais completos do step (ordem, fontes a consultar, template) ficam no command/skill do archive: `.claude/commands/opsx/archive.md` e `.claude/skills/openspec-archive-change/SKILL.md`. A versão inline do `/dev-cycle` está no step 6 do `.claude/commands/dev-cycle.md`.

## Padrões de engenharia

### Manutenibilidade

- Estruture código por domínio (`src/modules/billing/`), não por tipo técnico (`src/components/`, `src/services/`). Cada módulo expõe sua superfície via `src/modules/<dominio>/index.ts` (barrel) — consumidores importam de `@/modules/<dominio>`, nunca de paths internos.
- Use branded types para IDs e valores semânticos (`UserId`, `Email`) em vez de `string` genérico.
- Modele estados como discriminated unions; evite combinações inválidas (`loading + data + error` no mesmo objeto).
- Funções devem ter propósito único. Se o nome contém "and", divida.
- Comentários explicam **por quê**, nunca **o quê**.

### Performance (Next.js)

- Server Components por padrão; `'use client'` só nas folhas que precisam de hooks/eventos.
- Use `<Suspense>` para streaming; nunca bloqueie a página esperando o dado mais lento.
- Paralelize fetches independentes com `Promise.all`. Nunca crie waterfalls.
- Cache deliberado: `fetch` com `next.revalidate`/`tags`, `unstable_cache` para queries não-fetch, `cache()` do React para dedupe.
- Use `revalidateTag`/`revalidatePath` para invalidação on-demand.
- `next/image` e `next/font` sempre. Nunca `<img>` ou fontes via CSS.
- `dynamic(() => import(...))` para componentes pesados ou raramente usados.

### Segurança

- Server Actions: sempre validar com Zod, autenticar via session, autorizar com dados da session (nunca do input).
- Nunca confie em IDs vindos do cliente para autorização.
- Separe env vars em `serverEnv` e `clientEnv` com validação Zod. `NEXT_PUBLIC_*` é exposto. Acesso direto a `process.env.*` fora de `src/shared/env/**` (e poucos arquivos CLI: `drizzle.config.ts`, `scripts/db-migrate.ts`, `src/shared/env/client.ts`, setups de teste) é bloqueado por ESLint — importe `serverEnv`/`clientEnv` em vez disso.
- Headers de segurança em `next.config.ts`: HSTS, X-Frame-Options, CSP, Referrer-Policy.
- Queries parametrizadas sempre. `$queryRawUnsafe` é proibido.
- Rate limiting em rotas públicas e endpoints sensíveis.
- Autenticação via lib estabelecida (Auth.js, Clerk, Lucia, Better Auth). Nunca implemente do zero.
- Nunca logue senhas, tokens, PII. Logue presença (`hasPassword: true`), não valor.

### Redução de complexidade

- YAGNI. Não abstraia por especulação.
- Regra de três: duplique até a terceira ocorrência antes de extrair.
- Evite arquitetura em camadas excessivas (`controller → service → use-case → repository → mapper`) em CRUDs simples.
- Boolean flags em parâmetros são red flag. Prefira funções separadas ou strategy.
- Composição (`<Table><TableHeader/></Table>`) > configuração (`<Table showHeader/>`).

### Princípios transversais

- Código e docstrings devem ser escritos em inglês
- Reversibilidade primeiro: decisões reversíveis decidem rápido, irreversíveis (DB, contratos públicos, auth) merecem investimento.
- Otimize para leitura. Código claro e verboso > clever e conciso.
- Boundaries (APIs, tipos exportados) estáveis; interior pragmático.

### TypeScript — não negociável

- `strict: true` sempre.
- `tsc --noEmit` na CI bloqueia merge.
- Sem `any`. `unknown` + narrowing quando o tipo é genuinamente desconhecido.
- Sem `@ts-ignore` sem comentário justificando e issue de follow-up.

## Testes — OBRIGATÓRIOS

Para **toda feature nova ou alteração**:

1. **Testes unitários** — lógica pura, validators, helpers, hooks.
2. **Testes de integração** — Server Actions, API Routes, queries Supabase (contra Supabase local via Docker).
3. **Testes E2E** — para fluxos críticos de UI (Playwright). Fluxos críticos incluem: cadastro/login, criação de paciente, agendamento, envio de lembrete WhatsApp, geração de receita, cobrança/PIX, sessão de telepsicologia, prontuário.

Teste comportamento, não implementação. Testing Library > snapshots de estrutura interna. PR sem cobertura adequada nas três camadas para o que foi mexido **não deve ser dado como pronto**. Se algo bloquear o teste (ex.: integração externa sem sandbox), declare explicitamente em vez de pular silenciosamente.

## Estrutura

A árvore canônica do repositório (estabelecida pela change `reorganize-folder-structure`):

```
src/
  app/                                     # Next.js App Router (rotas, layouts, route handlers)
    (auth)/login/                          # rotas públicas — shells finos que delegam para módulos
    (app)/dashboard/                       # shell autenticado da app
    api/                                   # Route Handlers (ex.: /api/health, /api/me)
  middleware.ts                            # edge middleware (gating de auth)
  modules/<dominio>/                       # código por domínio, uma pasta por capability
    auth/
      components/                          # componentes (client/server) do módulo
      server/                              # implementação das Server Actions (sem `'use server'`)
      lib/                                 # validators, mappers, branded types
      index.ts                             # API PÚBLICA do módulo
    health/
  shared/                                  # concerns cross-módulo (não depende de modules/)
    ui/                                    # primitivos shadcn/ui (era components/ui)
    lib/                                   # utils, logger
    env/                                   # env validado por Zod (server + client splits)
    supabase/                              # clientes Supabase (browser, server, middleware)
    db/                                    # Drizzle: client.ts + schema/ + migrations/
  __tests__/                               # TODOS os testes vivem aqui (centralizados)
    unit/                                  # Vitest unit (espelha a árvore de src/)
    integration/                           # Vitest + Testcontainers (*.int.test.ts)
      setup/, factories/
    e2e/
      _shared/postgres-container.ts        # módulo de boot COMPARTILHADO entre integration e seeded e2e
      seeded/                              # Playwright + mock GoTrue + Testcontainers
      real/                                # Playwright contra `supabase start`
    stubs/                                 # no-ops (ex.: server-only)
scripts/
  db-migrate.ts                            # CLI usado por `npm run db:migrate`
docs/                                      # docs humanas (inclui docs/prd/)
openspec/                                  # tracker de changes OpenSpec (ativas + arquivadas)
playwright.seeded.config.ts                # suíte e2e default
playwright.real.config.ts                  # suíte @auth-real
vitest.config.ts                           # unit
vitest.integration.config.ts               # integration
```

Pontos não-óbvios (leia antes de mexer):

- **Alias `@/*`**: resolve para `./src/*`. Nunca importe relativo (`../../...`).
- **Módulo expõe pelo `index.ts`**: consumidores importam de `@/modules/<dominio>`, não de paths internos (`@/modules/<dominio>/lib/...`). O barrel é o contrato; o interior é privado.
- **Client Component NÃO importa Server Action do barrel do módulo**: importar `signIn` de `@/modules/auth` em uma Client Component arrasta `server-only` no grafo (logger, supabase server client) e o RSC boundary checker quebra o build. **Para Client Components, importe a action do route shell** (`@/app/(auth)/login/actions`) — o Next compila isso num RPC stub seguro para o cliente. Para uso server-side (outros módulos de servidor, testes de servidor), o barrel é OK.
- **Route shells são finos**: `src/app/(auth)/login/actions.ts` é só `'use server'; export { signIn } from '@/modules/auth';`. A implementação real vive em `src/modules/auth/server/login.ts` como módulo regular (sem `'use server'` no topo) — o shell é o que torna a função uma Server Action endereçável pelo Next.
- **Container Postgres compartilhado**: `src/__tests__/e2e/_shared/postgres-container.ts` é importado tanto pelo `globalSetup` da integração quanto pelo wrapper do seeded e2e. Mudanças no boot/bootstrap vão lá, não duplique.
- **Tests centralizados, não colocados**: todo `*.test.ts(x)` vive em `src/__tests__/unit/<mirror>/`, todo `*.int.test.ts` vive em `src/__tests__/integration/`. O glob `src/__tests__/unit/**` cobre 100% da suíte unitária.
- **Skills de teste atualizadas**: `.claude/skills/{unit,integration,e2e}-tests/` refletem essa estrutura. Quando criar/revisar testes, consulte a skill apropriada.
