# Proposal — bootstrap-foundation

## Why

The repository today contains only PRDs, Claude configuration, and `.gitignore`. There is no `package.json`, no `tsconfig.json`, no Next.js skeleton — nothing that makes the gates required by `CLAUDE.md` (`npm run lint`, `typecheck`, `test:unit`, `format`) executable. Without this foundation, `/dev-cycle` cannot even start its first task: the `fullstack-developer` agent fails on the first `npm run check` invocation, and CI has nothing to run.

This wave establishes the minimum executable foundation: a Next.js 16 + TypeScript skeleton with strict type-checking, lint, format, pre-commit hooks, a unit test runner, and a CI workflow that blocks PRs when any of those gates fail.

This change is performed **manually**, not via `/dev-cycle` — the orchestrator depends on the very gates this change introduces.

## What Changes

### Language & quality
- `package.json` (npm) declaring Next.js 16+, React 19, TypeScript 5+ (strict), ESLint 9, Prettier, Husky, lint-staged, Vitest, `@playwright/test` (binary only — real suite lands in wave 2).
- `package-lock.json` committed.
- `.nvmrc` pinning Node 22 LTS.
- `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess`, path alias `@/*`, no `src/` directory (Next.js 16 default — root `app/`).
- ESLint config extending `next/core-web-vitals` + `@typescript-eslint` strict rules + import ordering. Banning `any`, `@ts-ignore` without comment, and `enum`.
- Prettier config (single file, plus integration with ESLint).
- Husky + lint-staged: pre-commit runs `lint --fix` + `prettier --write` + `tsc --noEmit` on staged files.
- npm scripts: `lint`, `format`, `typecheck`, `check` (chains the three), `test:unit`, `dev`, `build`, `start`.

### Next.js skeleton
- `next.config.ts` with security headers from `CLAUDE.md`: HSTS, X-Frame-Options DENY, base CSP, Referrer-Policy `strict-origin-when-cross-origin`, X-Content-Type-Options `nosniff`.
- Tailwind CSS + PostCSS configured (`tailwind.config.ts`, `app/globals.css`).
- shadcn/ui initialized: `components.json`, `lib/utils.ts` exporting `cn()`. No components installed yet — they come per-feature.
- `app/layout.tsx` with `next/font` (Inter or similar), root metadata, locale `pt-BR`.
- `app/page.tsx` placeholder rendering "HubrityP".

### Vitest unit
- `vitest.config.ts` with `environmentMatchGlobs` splitting node (`*.test.ts`) and jsdom (`*.test.tsx`).
- One smoke test for `cn()` co-located at `lib/utils.test.ts` to prove the runner works.

### Playwright placeholder
- `playwright.config.ts` installed (so `@playwright/test` resolves), `testDir: './e2e'`, empty `e2e/` folder, empty `e2e/tags.json`. Real suite arrives in wave 2.
- Document `npx playwright install --with-deps chromium` as a post-install step in the README.

### CI
- `.github/workflows/ci.yml` with a single job: `setup-node@v4` (Node 22, npm cache) → `npm ci` → `lint` → `typecheck` → `test:unit`.
- Triggers: `pull_request` and `push` to `main`.
- No integration or e2e jobs yet — they require infrastructure that arrives in wave 2.

### Documentation
- `README.md` covering local dev startup, prerequisites (Node 22 via nvm, Docker, gh), and the `npm run check` contract.
- `.env.example` empty with comments noting that variables arrive in wave 2.
- Update `CLAUDE.md`: change "Node.js 20 LTS" to "Node.js 22 LTS" and adjust any consequential references.

## Non-goals

Out of scope for this wave:

- Supabase, Drizzle, any database, `lib/env.ts`, or `@supabase/ssr`.
- Auth, middleware, login UI.
- Inngest, Resend, Twilio, Gemini, Asaas, or any external integration.
- Pino logger.
- Real Vitest integration tests or real Playwright e2e suites — only the runners are installed.
- Any domain feature (psychologist, patient, calendar, etc.).
- Observability (OpenTelemetry, Sentry).
- Docker Compose for the application stack — wave 2 introduces it once Supabase local is in scope.

## Impact

### Affected areas
- Entire repository structure: this is the first executable code in the repo. All subsequent changes inherit the conventions established here.
- `CLAUDE.md` text edit (Node version).

### Risk
- **Low risk on data**: this change touches no persistent data and no external systems.
- **High churn risk on tooling**: ESLint rules, tsconfig flags, Prettier conventions, and the absence of `src/` are decisions that propagate everywhere. Reverting them later means touching every file. Lock these in before wave 2 starts.

### Decisions frozen by this wave
- Package manager: **npm** (not pnpm/bun).
- Directory layout: **no `src/`** — `app/`, `lib/`, `components/` at root.
- Path alias: **`@/*` only**.
- Node version: **22 LTS**.
- Lint stack: **ESLint 9 flat config** with TypeScript strict rules.
- CSS: **Tailwind + shadcn/ui**, no other design system.

### Validation
At the end of this change:
- `npm run check` passes.
- `npm run test:unit` passes (the `cn()` smoke test).
- `npm run dev` boots a Next.js app on `localhost:3000` rendering the placeholder.
- A PR exercising all of the above passes the new GitHub Actions workflow.
