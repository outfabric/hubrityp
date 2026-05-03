## 1. Skeleton and config groundwork

- [x] 1.1 Create empty target directories (`src/`, `src/app/`, `src/modules/`, `src/modules/auth/{components,server,lib}/`, `src/modules/health/lib/`, `src/shared/{ui,lib,env,supabase,db}/`, `src/shared/db/{schema,migrations}/`, `src/__tests__/{unit,integration/{setup,factories},e2e/{_shared,seeded/setup,real/setup},stubs}/`, `scripts/`, `docs/prd/`). Add empty `.gitkeep` files where the directory must persist before files arrive. [unit]
- [x] 1.2 Update `tsconfig.json` `compilerOptions.paths` so `"@/*"` resolves to `["./src/*"]`. Run `npm run typecheck` — expect failures because files have not moved yet (acceptable; this task only confirms the alias change does not break parsing). [unit]
- [x] 1.3 Update `next.config.ts` to add `outputFileTracingExcludes: { '/**': ['**/__tests__/**'] }` (defense-in-depth so tests never leak into the production bundle). Document in inline comment that Next.js auto-detects `src/app/` so no `app` config is needed. [unit]
- [x] 1.4 Confirm `.gitignore` covers `.temp/`, `playwright-report*/`, `test-results*/`, `playwright/.cache/`, `.next/`, `node_modules/`, `*.tsbuildinfo`. Add any missing entries. [unit]

## 2. Move shared infrastructure (leaf-first)

- [x] 2.1 `git mv lib/utils.ts src/shared/lib/utils.ts` and `git mv lib/utils.test.ts src/__tests__/unit/shared/lib/utils.test.ts`. Codemod: rewrite imports of `@/lib/utils` → `@/shared/lib/utils` repository-wide. [unit]
- [x] 2.2 `git mv lib/logger.ts src/shared/lib/logger.ts` and `git mv lib/logger.test.ts src/__tests__/unit/shared/lib/logger.test.ts`. Codemod: rewrite imports of `@/lib/logger` → `@/shared/lib/logger`. [unit]
- [x] 2.3 Move env modules: `git mv lib/env.ts src/shared/env/index.ts`, `git mv lib/env/* src/shared/env/`, `git mv lib/env/schemas.test.ts src/__tests__/unit/shared/env/schemas.test.ts`. Codemod: rewrite imports of `@/lib/env`, `@/lib/env/*` → `@/shared/env`, `@/shared/env/*`. Update ESLint `no-restricted-imports` allow-list paths to the new locations. [unit]
- [x] 2.4 Move Supabase clients: `git mv lib/supabase/client.ts src/shared/supabase/client.ts`, `git mv lib/supabase/server.ts src/shared/supabase/server.ts`, `git mv lib/supabase/middleware.ts src/shared/supabase/middleware.ts`. Move colocated tests to `src/__tests__/unit/shared/supabase/`. Codemod: rewrite imports of `@/lib/supabase/*` → `@/shared/supabase/*`. [unit]
- [x] 2.5 Run `npm run typecheck` and `npm run lint`. Fix any missed import. Run `npm run test:unit` to confirm shared layer is intact. [unit]

## 3. Consolidate the data layer at `src/shared/db/`

- [x] 3.1 `git mv lib/db/index.ts src/shared/db/client.ts`. Codemod: rewrite imports of `@/lib/db` → `@/shared/db/client`. [unit]
- [x] 3.2 `git mv db/schema/* src/shared/db/schema/` (preserves the `health/` subtree and `index.ts`). Codemod: rewrite imports of `@/db/schema`, `@/db/schema/*` → `@/shared/db/schema`, `@/shared/db/schema/*`. [unit]
- [x] 3.3 `git mv db/migrations src/shared/db/migrations` (entire directory including `meta/` and `README.md`). [unit]
- [x] 3.4 `git mv db/migrate.ts scripts/db-migrate.ts`. Update internal references inside the script to reflect the new working directory if the script uses relative paths. Update `package.json` script: `"db:migrate": "tsx scripts/db-migrate.ts"`. Add `scripts/db-migrate.ts` to the ESLint `process.env` allow-list. [unit]
- [x] 3.5 Update `drizzle.config.ts`: `schema: './src/shared/db/schema'`, `out: './src/shared/db/migrations'`. Run `npx drizzle-kit generate --dry-run` (or equivalent inspection) to verify the config is parseable. [unit]
- [x] 3.6 Remove the now-empty `db/` and `lib/db/` directories. Run `npm run typecheck` and `npm run lint`. [unit]

## 4. Move shadcn primitives to `src/shared/ui/`

- [x] 4.1 `git mv components/ui/* src/shared/ui/`. Remove the now-empty `components/ui/` and `components/`. Codemod: rewrite imports of `@/components/ui/*` → `@/shared/ui/*`. [unit]
- [x] 4.2 Update `components.json`: `"aliases.components": "@/shared/ui"`, `"aliases.utils": "@/shared/lib/utils"`. Run `npm run lint` and `npm run typecheck`. [unit]

## 5. Create `src/modules/auth/` and migrate auth code

- [x] 5.1 Move auth-domain helpers: `git mv lib/auth/login-input-schema.ts src/modules/auth/lib/login-input-schema.ts`, `git mv lib/auth/map-supabase-user.ts src/modules/auth/lib/map-supabase-user.ts`, `git mv lib/auth/safe-redirect.ts src/modules/auth/lib/safe-redirect.ts`. Move colocated tests to `src/__tests__/unit/modules/auth/lib/`. Codemod: rewrite imports of `@/lib/auth/*` → `@/modules/auth/lib/*`. [unit]
- [x] 5.2 Create `src/modules/auth/index.ts` re-exporting `loginInputSchema`, `mapSupabaseUser`, `safeRedirect`, `LoginForm`, `signInImpl as signIn`, `signOutImpl as signOut` (the last three populated in steps 5.3 and 7). [unit]
- [x] 5.3 Move `LoginForm`: `git mv app/(auth)/login/login-form.tsx src/modules/auth/components/login-form.tsx` and `git mv app/(auth)/login/login-form.test.tsx src/__tests__/unit/modules/auth/components/login-form.test.tsx`. Update internal imports inside `login-form.tsx` (validators come from `@/modules/auth/lib/login-input-schema`, the `signIn` action is imported from the route shell at `@/app/(auth)/login/actions` after step 7). [unit]
- [x] 5.4 Run `npm run typecheck`, `npm run lint`, `npm run test:unit`. [unit]

## 6. Create `src/modules/health/` and migrate health helpers

- [x] 6.1 If any helper files exist under `lib/` that are health-specific (per audit), `git mv` them to `src/modules/health/lib/`. If none exist (current state), create only `src/modules/health/index.ts` (empty barrel) and document in the file that the module currently exposes its surface via the schema (`@/shared/db/schema/health`) and the `/api/health` route. [unit]

## 7. Refactor auth shell ↔ module split

- [x] 7.1 Create `src/modules/auth/server/login.ts` containing the existing `signIn` action body extracted from `app/(auth)/login/actions.ts`. Export it as `signInImpl(formData: FormData)`. The function MUST be a regular module (no top-level `'use server'`); the route shell wraps it. Imports use `@/shared/supabase/server`, `@/modules/auth/lib/login-input-schema`, `@/modules/auth/lib/safe-redirect`, `@/shared/lib/logger`. [unit]
- [x] 7.2 Create `src/modules/auth/server/logout.ts` containing the existing `signOut` action body extracted from `app/(app)/actions.ts`. Export it as `signOutImpl()`. [unit]
- [x] 7.3 Update `src/modules/auth/index.ts` to re-export `LoginForm`, `signInImpl as signIn`, `signOutImpl as signOut` (in addition to the lib re-exports from 5.2). [unit]
- [x] 7.4 Replace `app/(auth)/login/actions.ts` with a thin shell that declares `'use server'` and exports `signIn` as a wrapper around `signInImpl` from `@/modules/auth`. [unit]
- [x] 7.5 Replace `app/(app)/actions.ts` with a thin shell that declares `'use server'` and exports `signOut` as a wrapper around `signOutImpl` from `@/modules/auth`. [unit]
- [x] 7.6 Update `app/(auth)/login/page.tsx` to import `<LoginForm/>` from `@/modules/auth` (after step 8 the path is `@/modules/auth` regardless). [unit]
- [x] 7.7 Run `npm run typecheck`, `npm run lint`, `npm run test:unit`. Verify Server Action wiring (no `'use server'` directives missing). [unit]

## 8. Move `app/` and `middleware.ts` under `src/`

- [x] 8.1 `git mv app src/app`. Verify Next.js auto-detects the new location: `npm run build` should still succeed. [unit]
- [x] 8.2 `git mv middleware.ts src/middleware.ts`. Verify the middleware is still invoked: `npm run build` and a quick `npm run dev` smoke (curl `/dashboard` anonymously expects 307). [unit]
- [x] 8.3 Codemod: any remaining imports of `@/app/*` (rare) continue to resolve since the `@/*` alias now points at `src/*`. Sweep for hardcoded `app/` paths in non-import contexts (config files, scripts) and update them. [unit]
- [x] 8.4 Run `npm run check` end-to-end. [unit]

## 9. Centralize tests under `src/__tests__/`

- [x] 9.1 Move integration suite: `git mv __tests__/integration src/__tests__/integration`. Update `vitest.integration.config.ts`: `globalSetup: ['./src/__tests__/integration/setup/global-setup.ts']`, `include: ['src/__tests__/integration/**/*.int.test.ts']`, `alias: { '@': path.resolve(rootDir, 'src') }`, `'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts')`. Update internal imports inside the integration setup files. [integration]
- [x] 9.2 Extract the shared Postgres container module: `git mv src/__tests__/integration/setup/postgres-container.ts src/__tests__/e2e/_shared/postgres-container.ts`. Update integration `globalSetup` and the soon-to-arrive seeded e2e `globalSetup` to import from `@/__tests__/e2e/_shared/postgres-container`. [integration]
- [x] 9.3 Move the seeded e2e suite: `git mv e2e src/__tests__/e2e/seeded` (renames `e2e/` to `seeded/` under the new tree). Move setup files under `src/__tests__/e2e/seeded/setup/` (auth.setup.ts, global-setup.ts, global-teardown.ts, start-server.ts, seed-state.ts). Move the tag registry to `src/__tests__/e2e/seeded/tags.json`. Update `playwright.config.ts` → rename to `playwright.seeded.config.ts`, set `testDir: './src/__tests__/e2e/seeded'`, `globalSetup: './src/__tests__/e2e/seeded/setup/global-setup.ts'`, `globalTeardown: './src/__tests__/e2e/seeded/setup/global-teardown.ts'`, update `webServer.command` to point at the relocated `start-server.ts`. [e2e]
- [x] 9.4 Move the mock GoTrue helper: `git mv lib/test-utils/mock-gotrue.ts src/__tests__/e2e/seeded/setup/mock-gotrue.ts` and `git mv lib/test-utils/mock-gotrue.test.ts src/__tests__/unit/__tests__/e2e/seeded/setup/mock-gotrue.test.ts` (or a more idiomatic location under `src/__tests__/unit/`). Update `start-server.ts` to import from the new path. Remove the now-empty `lib/test-utils/`. [e2e] [unit]
- [x] 9.5 Move the real e2e suite: `git mv e2e-auth-real src/__tests__/e2e/real`. Move setup files to `src/__tests__/e2e/real/setup/` (global-setup.ts, global-teardown.ts, credentials.ts). Rename `playwright.auth-real.config.ts` → `playwright.real.config.ts`, set `testDir: './src/__tests__/e2e/real'`, `globalSetup: './src/__tests__/e2e/real/setup/global-setup.ts'`, `globalTeardown: './src/__tests__/e2e/real/setup/global-teardown.ts'`, `outputDir: 'test-results-real'`, report folder `playwright-report-real`. [e2e]
- [x] 9.6 Move stubs: `git mv test/stubs src/__tests__/stubs`. Remove the now-empty `test/` directory. Update `vitest.config.ts` and `vitest.integration.config.ts` aliases for `server-only` accordingly. [unit] [integration]
- [x] 9.7 Update `vitest.config.ts`: `include: ['src/__tests__/unit/**/*.test.ts(x)']`, `exclude: [..., 'src/__tests__/integration', 'src/__tests__/e2e']`, `alias: { '@': path.resolve(rootDir, 'src') }`. [unit]
- [x] 9.8 Rename npm script `test:e2e` → `test:e2e:seeded` in `package.json`. Verify `test:e2e:real` still works. Verify both Playwright configs cannot run concurrently (port 54321) — keep the existing comment from `playwright.real.config.ts` documenting the constraint. [e2e]

## 10. Move documentation and clean up

- [x] 10.1 `git mv prd docs/prd`. Update any references in `CLAUDE.md`, `README.md`, or `docs/dev-cycle.md` that point at the root-level `prd/`. [unit]
- [x] 10.2 Confirm `.temp/` is gitignored and not tracked. [unit]
- [x] 10.3 Remove any now-empty top-level directories: `lib/` (if empty after step 5), `lib/test-utils/` (after 9.4), `app/` (after 8), `middleware.ts` (file already moved), `e2e/`, `e2e-auth-real/`, `__tests__/`, `test/`, `db/`, `components/`, `prd/`. Verify no stale `.gitkeep` or `.DS_Store` remains. [unit]

## 11. Update agent-facing skills and docs

- [x] 11.1 Update `.claude/skills/integration-tests/SKILL.md`: rewrite "Estrutura recomendada" section to show `src/__tests__/integration/` paths; update the canonical example to import from `@/__tests__/integration/setup/db`; note that the Postgres container module lives at `@/__tests__/e2e/_shared/postgres-container`. Update any `assets/` and `references/` files that reference old paths. [unit]
- [x] 11.2 Update `.claude/skills/e2e-tests/SKILL.md` (and assets/references): show `src/__tests__/e2e/seeded/` and `src/__tests__/e2e/real/`, the two Playwright configs, the shared `_shared/postgres-container.ts`, and the symmetric npm scripts. [unit]
- [x] 11.3 Update `.claude/skills/unit-tests/SKILL.md` (and assets/references): show centralized `src/__tests__/unit/` rather than colocated `*.test.ts` examples. [unit]
- [x] 11.4 Update `docs/dev-cycle.md` and `.claude/commands/dev-cycle.md` for any path references (test directories, integration-tests skill examples). [unit]
- [x] 11.5 Update `.claude/commands/opsx/archive.md` and `.claude/skills/openspec-archive-change/SKILL.md` if either references concrete paths under `db/`, `lib/`, `app/`, `e2e/`, or `__tests__/`. [unit]
- [x] 11.6 Update root `README.md`: refresh project structure section, npm script names (`test:e2e:seeded`), Playwright config filenames, and any quickstart paths. [unit]
- [x] 11.7 Update `CLAUDE.md`: refresh the "Estrutura" section to describe the new `src/`, `modules/`, `shared/`, `__tests__/`, `scripts/` layout; note the module-public-API rule (`index.ts` only); preserve all other guidance. [unit]

## 12. Update CI workflows

- [x] 12.1 Update `.github/workflows/*.yml` (typically `ci.yml`): replace `npm run test:e2e` with `npm run test:e2e:seeded`; update Playwright report artifact paths if they reference `playwright-report/` for the seeded suite (unchanged) and `playwright-report-real/` for the real suite (renamed from `playwright-report-auth-real/`); update any direct path references to `e2e/`, `e2e-auth-real/`, `__tests__/integration/`. Verify the `quality` → `integration` + `e2e` → `e2e-real` shape is preserved. [e2e] [integration]

## 13. Final verification

- [x] 13.1 Run `npm install` (or `npm ci`) to ensure the lockfile is clean after any incidental dependency changes. [unit]
- [x] 13.2 Run `npm run check`. Must exit 0. [unit]
- [x] 13.3 Run `npm run test:unit`. Must exit 0. [unit]
- [x] 13.4 Run `npm run test:integration`. Must exit 0. Confirm the Postgres container boots from `@/__tests__/e2e/_shared/postgres-container`. [integration]
- [x] 13.5 Run `npm run build`. Must exit 0. Inspect the build output trace and confirm no file under `src/__tests__/` appears. [unit]
- [x] 13.6 Run `npm run test:e2e:seeded`. Must exit 0. Confirm Playwright loads `playwright.seeded.config.ts` and runs the suite under `src/__tests__/e2e/seeded/`. [e2e]
- [x] 13.7 Run `npx supabase start` then `npm run test:e2e:real`. Must exit 0. Confirm Playwright loads `playwright.real.config.ts` and runs the suite under `src/__tests__/e2e/real/`. Run `npx supabase stop` afterwards. [e2e]
- [x] 13.8 Verify git history is preserved: run `git log --follow src/modules/auth/components/login-form.tsx`, `git log --follow src/shared/db/schema/health/tables.ts`, `git log --follow src/__tests__/integration/setup/db.ts`. Each should show pre-move history. [unit]
- [x] 13.9 Audit imports: `grep -r "from '@/lib/" src/` and `grep -r "from '@/db/" src/` and `grep -r "from '@/components/" src/` should return zero matches. [unit]
- [x] 13.10 Audit physical layout: confirm the legacy directories (`app/`, `lib/`, `db/`, `components/`, `e2e/`, `e2e-auth-real/`, `__tests__/`, `test/`, `prd/`) and the legacy files (`middleware.ts`, `playwright.config.ts`, `playwright.auth-real.config.ts`) no longer exist at the repository root. [unit]
