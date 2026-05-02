# Tasks — bootstrap-foundation

> This change is performed **manually**, not via `/dev-cycle`, because the orchestrator depends on the gates installed here. Test-layer tags follow the `dev-cycle.md` convention so that future changes can copy the convention; for this wave only `[unit]` is applicable.

## 1. Package and runtime baseline

- [x] 1.1 Create `package.json` with name, private, type=module, version, and the dependency set: Next 16+, React 19, react-dom 19, TypeScript 5+, ESLint 9, `@typescript-eslint/eslint-plugin` and `parser`, `eslint-config-next`, `eslint-plugin-import`, `eslint-config-prettier`, Prettier, `prettier-plugin-tailwindcss`, Husky, lint-staged, Vitest, `@vitest/coverage-v8`, jsdom, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`, Tailwind, `@tailwindcss/postcss`, autoprefixer, `clsx`, `tailwind-merge`, `lucide-react`
- [x] 1.2 Add `engines.node: ">=22 <23"` and `engines.npm: ">=10 <11"` to `package.json`
- [x] 1.3 Add `.nvmrc` pinning the active Node 22 LTS minor (e.g., `lts/jod` or the explicit `v22.x.x`)
- [x] 1.4 Add npm scripts: `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, `check`, `test:unit`, `test:e2e`, `prepare` (Husky)
- [x] 1.5 Run `npm install` and commit `package-lock.json`
- [x] 1.6 Update `CLAUDE.md`: change "Node.js 20 LTS" to "Node.js 22 LTS"; verify no other version-specific references break

## 2. TypeScript

- [x] 2.1 Create `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `jsx: "preserve"`, `paths: { "@/*": ["./*"] }`, `incremental: true`, plugins for Next
- [x] 2.2 Create `tsconfig.node.json` (or extend) for build-tool config files (`next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tailwind.config.ts`)
- [x] 2.3 Verify `npx tsc --noEmit` exits 0 against the empty project

## 3. ESLint flat config

- [x] 3.1 Create `eslint.config.mjs` with flat config: extends `next/core-web-vitals`, `@typescript-eslint/recommended-type-checked`, `eslint-plugin-import` rules, `eslint-config-prettier` last
- [x] 3.2 Add custom rules enforcing `CLAUDE.md`: ban `enum`, ban `// @ts-ignore` (allow `// @ts-expect-error` with description), restrict `../` relative imports in favor of `@/*`, enforce `import type` via `@typescript-eslint/consistent-type-imports`
- [x] 3.3 Add `.eslintignore` (or `ignores` block) covering `.next`, `node_modules`, `coverage`, `e2e/.cache`
- [x] 3.4 Verify `npm run lint` exits 0 on the empty project

## 4. Prettier

- [x] 4.1 Create `.prettierrc.json` with `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`, `plugins: ["prettier-plugin-tailwindcss"]`
- [x] 4.2 Create `.prettierignore` covering `.next`, `node_modules`, `coverage`, `package-lock.json`
- [x] 4.3 Verify `npm run format` rewrites files and `npm run format:check` exits 0 after a clean format pass

## 5. Pre-commit hooks

- [x] 5.1 Run `npx husky init` to scaffold `.husky/`
- [x] 5.2 Configure `lint-staged` block in `package.json`: stage `*.{ts,tsx}` runs `eslint --fix` + `prettier --write`; stage `*.{md,json,yml,yaml}` runs `prettier --write`
- [x] 5.3 Replace `.husky/pre-commit` with `npx lint-staged && npx tsc --noEmit`
- [x] 5.4 Make the pre-commit hook executable (`chmod +x .husky/pre-commit`)
- [x] 5.5 Manual smoke: stage a file with a deliberate `enum` violation, attempt `git commit`, verify it is rejected; reset

## 6. Next.js skeleton

- [x] 6.1 Create `next.config.ts` exporting a typed config with `reactStrictMode: true`, an async `headers()` function returning the security headers per the design doc (HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy disabling camera/microphone/geolocation, baseline CSP)
- [x] 6.2 Create `app/layout.tsx` as a Server Component: `<html lang="pt-BR">`, `next/font` (Inter or similar) applied to `<body>`, exported `metadata: Metadata` with title, default description, viewport
- [x] 6.3 Create `app/page.tsx` as a Server Component rendering a centered "HubrityP" headline using Tailwind utility classes
- [x] 6.4 Manual smoke: `npm run dev` and confirm `http://localhost:3000` returns 200 with "HubrityP" visible
- [x] 6.5 Manual smoke: `npm run build && npm run start` and confirm the production server serves the same placeholder
- [x] 6.6 Manual smoke: `curl -I http://localhost:3000` and confirm all required security headers are present in the response

## 7. Tailwind and shadcn baseline

- [x] 7.1 Create `tailwind.config.ts` with `content` globs covering `app/**/*.{ts,tsx}`, `components/**/*.{ts,tsx}`, theme extensions for shadcn (CSS variables) and `darkMode: "class"`
- [x] 7.2 Create `postcss.config.mjs` with `@tailwindcss/postcss` and `autoprefixer`
- [x] 7.3 Create `app/globals.css` with shadcn slate-base CSS variables (Tailwind 4 uses `@import 'tailwindcss';` instead of v3-style `@tailwind` directives)
- [x] 7.4 Import `app/globals.css` in `app/layout.tsx`
- [x] 7.5 Create `components.json` with shadcn config: `style: "default"`, `rsc: true`, `tsx: true`, `tailwind.config: "tailwind.config.ts"`, `tailwind.css: "app/globals.css"`, `tailwind.baseColor: "slate"`, aliases `@/components`, `@/lib/utils`
- [x] 7.6 Create `lib/utils.ts` exporting `cn(...inputs: ClassValue[])` via `clsx` + `tailwind-merge`

## 8. Vitest unit runner

- [x] 8.1 Create `vitest.config.ts` with `environmentMatchGlobs`: `**/*.test.tsx → "jsdom"`, `**/*.test.ts → "node"`, `globals: true`, alias `@` → repo root
- [x] 8.2 Create `vitest.setup.ts` importing `@testing-library/jest-dom/vitest` (used by jsdom tests)
- [x] 8.3 Wire `setupFiles` to `vitest.setup.ts` in the config
- [x] 8.4 Create `lib/utils.test.ts` with smoke assertions for `cn()` covering: merging conflicting Tailwind classes, ignoring falsy inputs, joining multiple inputs `[unit]`
- [x] 8.5 Verify `npm run test:unit` passes

## 9. Playwright placeholder

- [x] 9.1 Create `playwright.config.ts` with `testDir: "./e2e"`, `fullyParallel: true`, an empty `projects: []` array, `use: { baseURL: "http://localhost:3000" }`
- [x] 9.2 Create empty `e2e/tags.json` containing `{}` (placeholder for wave 2)
- [x] 9.3 Document `npx playwright install --with-deps chromium` in `README.md` as a one-time setup step
- [x] 9.4 Verify `npx playwright test --list` runs without error (no tests found is acceptable in this wave)

## 10. CI workflow

- [x] 10.1 Create `.github/workflows/ci.yml` with triggers `pull_request` and `push: { branches: [main] }`
- [x] 10.2 Single job `quality` running on `ubuntu-latest`: checkout, `setup-node@v4` with `node-version-file: .nvmrc` and `cache: npm`, `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:unit`
- [x] 10.3 Add `permissions: { contents: read }` at workflow level
- [ ] 10.4 Manual smoke: push the branch, open a draft PR, confirm the workflow runs and is green
- [ ] 10.5 Manual smoke: introduce a deliberate type error in a temporary commit, confirm CI fails, then revert

## 11. Documentation

- [x] 11.1 Create `README.md` with sections: Prerequisites (Node 22 via nvm, npm 10+, Docker for wave 2), Install (`npm install` + `npx playwright install`), Local dev (`npm run dev`), Quality contract (`npm run check`), Scripts table, Project layout (one-liner)
- [x] 11.2 Create `.env.example` with a header comment noting that variables arrive in `bootstrap-data-and-tests`
- [x] 11.3 Re-read `CLAUDE.md` and reconcile any inconsistency surfaced during implementation (e.g., script names, paths)

## 12. Final validation

- [x] 12.1 Run `npm run check` end-to-end on a clean checkout; expect exit 0
- [x] 12.2 Run `npm run test:unit`; expect exit 0
- [x] 12.3 Run `npm run dev` and curl `/`; expect 200 + security headers
- [ ] 12.4 Open the PR for this change and confirm the CI `quality` job is green
- [ ] 12.5 Merge to `main`; verify `bootstrap-data-and-tests` has a clean foundation to build on
