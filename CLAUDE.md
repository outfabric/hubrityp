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
- **Supabase RLS sempre habilitado** em qualquer tabela nova — psicólogo só acessa dados dos próprios pacientes. Migrations sem policy RLS devem ser tratadas como bug.
- Dados sensíveis (prontuário, transcrições, áudios) seguem LGPD: nunca logar conteúdo, nunca enviar para serviços fora do Brasil sem aprovação explícita.

## Workflow de change (dev-cycle)

Features novas e refactors não triviais seguem o ciclo:

1. **Planejar a change** com `/opsx:new` (passo a passo) ou `/opsx:ff` (gera todos os artefatos de uma vez). Resultado: `openspec/changes/<name>/` com `proposal.md`, `tasks.md`, `design.md` e `specs/`.
2. **Executar a change** com `/dev-cycle <name>`. O comando orquestra o ciclo fechado:
   - Cria um git worktree dedicado em `../hubrityp-<name>/` na branch `feature/<name>`.
   - Para cada task em ordem: invoca `fullstack-developer` → ele implementa, escreve testes (camadas indicadas pelas tags `[unit]` `[integration]` `[e2e]`), roda `npm run check`. Próxima task só inicia quando todos os gates da atual passam.
   - Quando todas as tasks estão `[x]`: invoca `code-reviewer` (loop dev↔reviewer com cap de 3 iterações) e depois `qa-tester` (loop dev↔QA com cap de 3 iterações). Cada fix pós-feedback executa re-validação escopada (lint+typecheck → unit full → integration `--related` → e2e `--grep`) com fallback para suítes completas em sinais amplos (schema/types/utils/auth/config/>10 arquivos).
   - Quando reviewer e QA estão limpos: cria commits semânticos (Conventional Commits, idealmente um por task), faz push e abre PR via `gh`.
3. **Revisar o PR**, mergear, e arquivar a change com `/opsx:archive`.

**Convenção de tags em `tasks.md`**: cada linha de task pode terminar em `[unit]`, `[integration]`, `[e2e]` (qualquer subconjunto). Default se ausente: `[unit]`. As tags determinam quais camadas de teste o `fullstack-developer` deve criar/atualizar para aquela task.

**Artefatos do orquestrador**: relatórios de review e QA são persistidos em `<worktree>/.dev-cycle/{review-N.md, qa-N.md, ...}` (gitignored). O worktree é descartável e pode ser removido com `git worktree remove ../hubrityp-<name>` após o merge do PR.

**Documentação completa**: `docs/dev-cycle.md`.

## Padrões de engenharia

### Manutenibilidade

- Estruture código por domínio (`modules/billing/`), não por tipo técnico (`components/`, `services/`).
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
- Separe env vars em `serverEnv` e `clientEnv` com validação Zod. `NEXT_PUBLIC_*` é exposto. Acesso direto a `process.env.*` fora de `lib/env.ts` (e poucos arquivos CLI: `drizzle.config.ts`, `db/migrate.ts`, `lib/env/client.ts`, setups de teste) é bloqueado por ESLint — importe `serverEnv`/`clientEnv` em vez disso.
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

Repo ainda em estágio inicial. Ao introduzir a estrutura de código, siga convenções padrão do Next.js App Router (`app/`, `lib/`, `components/`) e atualize este arquivo com decisões não óbvias.
