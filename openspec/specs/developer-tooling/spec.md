# developer-tooling Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
### Requirement: Quality scripts execute end-to-end

The system SHALL expose npm scripts `lint`, `format`, `typecheck`, and `check` that run successfully on a clean checkout. The `check` script MUST chain `lint`, `format --check`, and `typecheck` in that order and fail fast on the first failing step.

#### Scenario: Clean repository passes all gates

- **WHEN** a developer runs `npm run check` against a freshly-cloned, freshly-installed repository with no source modifications
- **THEN** the command exits with code 0 and prints success output for `lint`, `format --check`, and `typecheck`

#### Scenario: Lint failure blocks the chain

- **WHEN** a developer introduces an ESLint violation (e.g., uses `any` or `// @ts-ignore` without justification) and runs `npm run check`
- **THEN** the command exits with non-zero status during the `lint` step and does not run `format --check` or `typecheck`

#### Scenario: Type error blocks the chain

- **WHEN** a developer introduces a type error (e.g., assigns `string` to `number`) and runs `npm run check`
- **THEN** the command exits with non-zero status during the `typecheck` step

### Requirement: TypeScript strict configuration is enforced

The system SHALL configure TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, and the path alias `@/*` resolving to the repository root. `tsc --noEmit` MUST be the implementation of `npm run typecheck`.

#### Scenario: Strict null check rejects nullable assignment

- **WHEN** a developer writes `const x: string = process.env.MISSING` (which has type `string | undefined`)
- **THEN** `npm run typecheck` reports an error and the project does not type-check

#### Scenario: Index access requires undefined narrowing

- **WHEN** a developer writes `const first: string = ["a", "b"][0]` without narrowing
- **THEN** `npm run typecheck` reports that the access yields `string | undefined`

#### Scenario: Path alias resolves from any depth

- **WHEN** a developer imports `import { cn } from '@/lib/utils'` from any source file under the repository
- **THEN** the import resolves and `npm run typecheck` succeeds

### Requirement: ESLint enforces project conventions

The system SHALL enforce, via ESLint flat config, the conventions stated in `CLAUDE.md`: no `any`, no `enum`, no relative imports of the form `../../*`, no unjustified `@ts-ignore`. Type-aware rules MUST be active (`@typescript-eslint/recommended-type-checked` or equivalent).

#### Scenario: Forbidden enum is reported

- **WHEN** a developer commits a file containing `enum Role { Admin, User }`
- **THEN** `npm run lint` reports an error and exits non-zero

#### Scenario: Deep relative import is reported

- **WHEN** a developer writes `import { foo } from '../../../lib/foo'`
- **THEN** `npm run lint` reports an error and suggests `@/lib/foo`

### Requirement: Pre-commit hook blocks bad commits

The system SHALL install a Husky pre-commit hook that runs `lint-staged` against staged files. The hook MUST execute `eslint --fix` and `prettier --write` on staged files and run a project-wide `tsc --noEmit` before allowing the commit.

#### Scenario: Bad commit is rejected

- **WHEN** a developer stages a file with a lint violation and runs `git commit`
- **THEN** the pre-commit hook reports the violation and the commit does not complete

#### Scenario: Auto-fixable violations are repaired and re-staged

- **WHEN** a developer stages a file with formatting issues only (no lint errors) and runs `git commit`
- **THEN** Prettier rewrites the file, the changes are added to the commit, and the commit completes

### Requirement: Unit test runner is operational

The system SHALL provide an `npm run test:unit` script backed by Vitest. The configuration MUST split test environments by file extension: `*.test.ts` runs in the `node` environment and `*.test.tsx` runs in the `jsdom` environment.

#### Scenario: Smoke unit test passes

- **WHEN** the suite contains the smoke test for `cn()` (or equivalent) and the developer runs `npm run test:unit`
- **THEN** Vitest discovers the test, runs it in the correct environment, and reports a passing result

#### Scenario: Failing unit test exits non-zero

- **WHEN** any `*.test.ts(x)` file contains a failing assertion and the developer runs `npm run test:unit`
- **THEN** the command exits with non-zero status and prints the failure

### Requirement: CI quality gate runs on every PR and main push

The system SHALL provide a GitHub Actions workflow that runs the same quality gates as local development on every `pull_request` and every `push` to `main`. The workflow MUST install Node from `.nvmrc`, cache npm, install dependencies via `npm ci`, and run `lint`, `typecheck`, and `test:unit` in that order.

#### Scenario: Failing PR is blocked

- **WHEN** a contributor opens a PR introducing a TypeScript error
- **THEN** the `quality` job in GitHub Actions exits non-zero and the PR cannot be merged with the gate as a required check

#### Scenario: Clean PR passes the gate

- **WHEN** a contributor opens a PR with `npm run check` and `npm run test:unit` passing locally
- **THEN** the `quality` job in GitHub Actions exits 0 and the PR is mergeable

#### Scenario: Workflow uses pinned Node version

- **WHEN** the CI workflow boots
- **THEN** the Node version it installs matches the `.nvmrc` file in the repository (Node 22 LTS)

