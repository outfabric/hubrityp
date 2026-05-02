# HubrityP

SaaS para psicólogos autônomos brasileiros. Plataforma única para agenda, prontuário, lembretes WhatsApp, receita e cobrança.

## Prerequisites

- **Node.js 22 LTS** (use `nvm use` — version pinned in `.nvmrc`).
- **npm 10+** (ships with Node 22).
- **Docker** + Docker Compose (used in upcoming waves for Supabase local).
- **gh CLI** (for opening PRs).

## Install

```bash
nvm use
npm install
npx playwright install --with-deps chromium   # one-time, only when working on e2e tests
```

## Local development

```bash
npm run dev
```

Open <http://localhost:3000>.

## Quality contract

Every change must pass the same gates locally that CI runs:

```bash
npm run check        # lint + format:check + typecheck (fail-fast)
npm run test:unit    # Vitest
```

Pre-commit hooks (Husky + lint-staged) run `eslint --fix`, `prettier --write` on staged files and then `tsc --noEmit` project-wide. Do not bypass with `--no-verify`.

## Scripts

| Script                 | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `npm run dev`          | Start Next.js dev server on `localhost:3000`.                |
| `npm run build`        | Production build.                                            |
| `npm run start`        | Serve the production build.                                  |
| `npm run lint`         | ESLint flat config (Next core-web-vitals + TS type-checked). |
| `npm run format`       | Prettier `--write` over the repo.                            |
| `npm run format:check` | Prettier `--check` (no rewrites).                            |
| `npm run typecheck`    | `tsc --noEmit` strict mode.                                  |
| `npm run check`        | `lint && format:check && typecheck`.                         |
| `npm run test:unit`    | Vitest run (jsdom for `*.test.tsx`, node for `*.test.ts`).   |
| `npm run test:e2e`     | Playwright (suite arrives in a later change).                |

## Project layout

`app/` (App Router) · `components/` · `lib/` · `e2e/` (Playwright) · `openspec/` (change docs).

## Documentation

- Engineering contract & domain context: [`CLAUDE.md`](./CLAUDE.md).
- Dev cycle workflow: [`docs/dev-cycle.md`](./docs/dev-cycle.md).
