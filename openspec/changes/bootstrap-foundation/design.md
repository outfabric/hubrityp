# Design — bootstrap-foundation

## Context

The repository contains only PRDs, Claude configuration, and `.gitignore` — no executable code, no `package.json`, no Next.js skeleton. The `CLAUDE.md` engineering contract demands `npm run lint`, `format`, `typecheck`, `test:unit`, and `check` to be runnable, plus a CI gate that blocks bad PRs. The `/dev-cycle` orchestrator is hard-wired to those gates: its first per-task action is `npm run check`, and it cannot start without a working test runner. Two downstream changes (`bootstrap-data-and-tests` and `smoke-health-feature`) depend on this foundation.

This wave is performed manually, not via `/dev-cycle`, because the orchestrator depends on the very gates being introduced here.

Local environment: Node 22.18.0 already installed (CLAUDE.md still says Node 20 — to be updated here), Docker 28.3.3 available, git/GitHub remote configured (`gh` not yet verified). The repo lives at `/home/antonio/Documentos/repos/hubrityp` on Linux.

## Goals / Non-Goals

**Goals:**
- Make `npm run lint`, `format`, `typecheck`, `check`, `test:unit`, `dev`, `build`, `start` executable end-to-end.
- Lock in TypeScript strict + lint rules + formatting conventions before any feature code is written.
- Boot a Next.js 16 App Router app on `localhost:3000` rendering a placeholder.
- Enforce the same gates in CI for every PR and every push to `main`.
- Pin Node 22 LTS via `.nvmrc` and `engines`.
- Make pre-commit hooks block bad commits without bypass via `--no-verify`.

**Non-Goals:**
- Supabase, Drizzle, any database, environment validation, auth library, or middleware (wave 2).
- Real Vitest integration tests or Playwright e2e suites with assertions — only the runners are installed.
- Any domain UI or business logic.
- Inngest, Resend, Twilio, Gemini, Asaas, or other external integrations (wave 2+).
- Pino logger and LGPD redaction (wave 2).
- Docker Compose for the application stack (wave 2 introduces Supabase local first).
- Custom error pages, observability, rate limiting.

## Decisions

### D1 — Package manager: npm

Use **npm** with a committed `package-lock.json`, locked to npm 10.x via `engines.npm`. Alternatives considered: pnpm (faster installs, stricter hoisting), bun (fastest, but ecosystem still maturing in Q2 2026). CLAUDE.md already prescribes npm; consistency with the contract beats marginal speed gains, and Vercel build cache is well-tuned for npm.

### D2 — Directory layout: no `src/`, root-level `app/` `lib/` `components/`

Use Next.js 16's default layout (everything at root). Alternatives considered: `src/`-rooted layout (cleaner, but adds one path segment everywhere and diverges from `create-next-app` defaults). The `@/*` path alias points to root, so the difference is purely cosmetic at import sites; we follow the framework default.

### D3 — TypeScript: strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`

Enable strict mode plus `noUncheckedIndexedAccess` (required by CLAUDE.md's "no `any`" stance — array indexing must yield `T | undefined`) and `verbatimModuleSyntax` (forces explicit `import type` for type-only imports, prevents emit surprises). Path alias `@/*` resolves to repo root. `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"` (matches Next.js 16 + Vercel).

### D4 — ESLint: flat config (eslint.config.mjs) on ESLint 9

ESLint 9 deprecated `.eslintrc.*`. Use the new flat config format. Stack:
- `next/core-web-vitals` ruleset.
- `@typescript-eslint/recommended-type-checked` (full type-aware linting).
- `eslint-plugin-import` for ordering.
- Custom rules enforcing CLAUDE.md: ban `enum`, ban `any` (already in TS strict), ban `// @ts-ignore` (allow `// @ts-expect-error` with description), restrict relative imports (`../../..` forbidden in favor of `@/*`).

Alternative considered: Biome (single-binary lint+format). Faster, but less mature for type-aware rules and no Next.js plugin parity. Defer.

### D5 — Format: Prettier with single config

Use Prettier alongside ESLint (`eslint-config-prettier` disables conflicting rules). Single root `.prettierrc` with: `singleQuote: true`, `semi: true`, `trailingComma: 'all'`, `printWidth: 100`, `tabWidth: 2`. Tailwind plugin (`prettier-plugin-tailwindcss`) sorts className strings.

### D6 — Pre-commit: Husky + lint-staged

Husky installs git hooks; lint-staged runs only against staged files for speed. Pre-commit pipeline: `eslint --fix` + `prettier --write` + a tsc-staged-like type-check (we run `tsc --noEmit` on the whole project rather than per-file because TypeScript's project-wide nature makes per-file checks unreliable). On a small bootstrap codebase, the full-project tsc takes <2s; we revisit if it becomes painful.

`--no-verify` is forbidden by policy and will be denied at code review.

### D7 — Vitest: split jsdom/node via `environmentMatchGlobs`

Use Vitest 2.x with a single `vitest.config.ts`. Files matching `**/*.test.tsx` use `jsdom` (React component logic), `**/*.test.ts` use `node` (pure logic). This avoids the cost of running every test in jsdom and matches the convention used by the `unit-tests` skill.

`@vitest/coverage-v8` installed but coverage thresholds are deferred to wave 2 (no meaningful code yet).

### D8 — Playwright: install but defer the suite

Install `@playwright/test` and write a minimal `playwright.config.ts` (testDir `./e2e`, projects array empty for now), plus an empty `e2e/tags.json`. This guarantees the package resolves and `npm run test:e2e` doesn't error on a missing config when wave 2 starts. The browser binary is **not** auto-installed during `npm install` — document `npx playwright install --with-deps chromium` as a one-time step in `README.md`.

### D9 — Tailwind + shadcn/ui scaffold, no components

Run `tailwindcss init -p` to scaffold `tailwind.config.ts` and `postcss.config.js`. Run `npx shadcn@latest init` to create `components.json`, `lib/utils.ts` (with `cn()`), and the CSS variables in `app/globals.css`. **No shadcn primitive components are added in this wave** — they come per feature.

shadcn config: `default` style, `slate` base color, `rsc: true`, `tsx: true`, `tailwindCss: 'app/globals.css'`, alias `@/components` and `@/lib/utils`.

### D10 — Security headers in `next.config.ts`

Set headers via the `headers()` async function:
- `Strict-Transport-Security`: `max-age=63072000; includeSubDomains; preload`.
- `X-Frame-Options`: `DENY`.
- `X-Content-Type-Options`: `nosniff`.
- `Referrer-Policy`: `strict-origin-when-cross-origin`.
- `Permissions-Policy`: `camera=(), microphone=(), geolocation=()` (will be relaxed for telepsicologia in a later change).
- Base CSP: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:`. The `'unsafe-inline'` for scripts is a Next.js requirement (inline hydration scripts) — we'll tighten with nonces in a later hardening change. Documented as a known gap.

### D11 — CI: single workflow file, single job in this wave

`.github/workflows/ci.yml` triggers on `pull_request` and `push` to `main`. Single job `quality`:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` with `node-version-file: '.nvmrc'`, `cache: 'npm'`
3. `npm ci`
4. `npm run lint`
5. `npm run typecheck`
6. `npm run test:unit`

No matrix, no concurrency cancellation rules yet (wave 2 adds those when e2e runtime grows). Workflow file kept simple; complexity added when justified.

### D12 — README scope

Minimal: prerequisites (Node 22 via nvm, npm 10+, Docker — even though not used yet, mention for wave 2), install steps, the `npm run check` contract, scripts table, and Playwright browser install note. Defer architecture/contributor docs to a later change.

### D13 — Update CLAUDE.md to Node 22 LTS

Replace "Node.js 20 LTS" with "Node.js 22 LTS" and check for any consequential references (none expected — most of CLAUDE.md is stack-level, not version-pinned). This is a one-line edit but it's the explicit decision the user made earlier; documenting it here keeps the trace.

## Risks / Trade-offs

- **CSP with `'unsafe-inline'` for scripts** → tightening to nonces requires Next.js middleware coordination; documented as a known gap and tracked for a future hardening change. Mitigated by the other headers being strict.
- **Pre-commit running full-project tsc** → could become slow as the codebase grows. Mitigation: revisit when warm tsc takes >5s; consider `tsc --build` with project references then.
- **Locking ESLint flat config + ESLint 9** → some plugins still ship classic configs in early 2026; if a critical plugin has no flat support we may need a wrapper. Risk is low because the chosen plugins all support flat config as of late 2025.
- **No `src/` directory** → if we later decide we want it, mass rename is mechanical but touches every file. Acceptable cost.
- **Pinning Node 22** → if a Vercel runtime regression appears, we'd need to test against Node 20 quickly. Mitigated by `.nvmrc` + `engines.node: '>=22 <23'` allowing minor flexibility.
- **Pre-commit type-check skipped via `--no-verify`** → forbidden by policy and called out in CLAUDE.md, but not technically blocked. Mitigation: code review catches it; CI catches the resulting type errors anyway.
- **Bootstrap is manual** → we're not exercising `/dev-cycle` here, so any orchestrator bug only surfaces in wave 3. Acceptable: this is a chicken-and-egg constraint, not an avoidable choice.

## Migration Plan

Not applicable — there is no prior state to migrate from. The change is a green-field bootstrap. Rollback is trivial (`git revert`). Deployment is implicit: there is no application yet, so a Vercel deployment is optional in this wave.

## Open Questions

- **Should we add a `CONTRIBUTING.md`?** Skipped for now; deferred until there's something to contribute to. Revisit after wave 3.
- **Vercel project linkage** — should this wave also create the Vercel project and connect the repo? Argument for: every PR getting a preview deploy from day one. Argument against: the app is empty and deploying nothing is noisy. **Recommendation: defer to wave 2** when there's at least a Supabase env to wire.
- **Renovate / Dependabot** — automated dependency PRs. Low cost to enable now (one config file), but will generate PR noise immediately. Defer to a later hygiene change.
