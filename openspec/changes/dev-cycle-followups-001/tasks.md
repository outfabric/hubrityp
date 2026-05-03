# Tasks — dev-cycle-followups-001

> Resolves three follow-ups from `docs/dev-cycle-retrospective-001.md` (sections 3 and 4): mock GoTrue helper relocation, Next.js/Playwright gotchas docs, `tasks.md` mutation rule. Tags `[unit]` `[integration]` `[e2e]` drive `fullstack-developer` test-layer selection per the dev-cycle convention.

## 1. Test util — lift mock GoTrue helper

- [x] 1.1 Create `lib/test-utils/mock-gotrue.ts` by lifting the implementation currently at `e2e/mock-gotrue.ts`. Reshape the public API so `startMockGotrue(options)` returns `{ port: number; stop: () => Promise<void>; jwt: string }`. Keep `buildFixedJwt` exported for callers that need to mint additional tokens. Default port is `54321` (per design Decision 3); accept a `port` override in `options`. Preserve the existing source comments explaining the build-time URL coupling. `[unit]`
- [x] 1.2 Create `lib/test-utils/mock-gotrue.test.ts` with at least three cases verifying the public contract: (a) `startMockGotrue()` returns `{ port, stop, jwt }` with the documented shapes (numeric port, async `stop`, three-segment JWT string); (b) the returned `jwt` parses as JWT and verifies against the helper's signing material; (c) after awaiting `stop()`, calling `startMockGotrue()` again on the same port succeeds without `EADDRINUSE`. Do NOT re-test `getUser()` semantics here — that lives in the e2e suite. `[unit]`
- [x] 1.3 Update `e2e/start-server.ts` to import `startMockGotrue` (and any sibling exports it currently uses) from `@/lib/test-utils/mock-gotrue` instead of the relative `./mock-gotrue` path. Adjust call sites for the new `{ port, stop, jwt }` shape (replace `url`/`close` with derived URL string + `stop`). `[e2e]`
- [x] 1.4 Delete `e2e/mock-gotrue.ts`. Run `npm run typecheck` and `grep -rn "from.*e2e/mock-gotrue" .` to confirm no orphan imports remain anywhere in the repo. `[e2e]`

## 2. Documentation — Next.js/Playwright/Supabase-CLI gotchas

- [x] 2.1 Append a top-level `## Gotchas` section to `docs/dev-cycle.md`. Use four `###` subsections, one per pitfall: (a) `NEXT_PUBLIC_*` build-time inlining into the edge runtime — explain why the e2e build must hardcode the mock GoTrue port and link to `lib/test-utils/mock-gotrue.ts`; (b) Playwright `webServer` boots before `globalSetup` — explain the consequence and link to `e2e/start-server.ts` as the canonical workaround; (c) `playwright.auth-real.config.ts` reads `npx supabase status -o json` synchronously at config-load — cross-reference (b), do not propose a `globalSetup`-based "fix"; (d) `supabase status -o json` payload uses `API_URL` / `DB_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` (uppercase + underscore), NOT camelCase. Each subsection should be 4–10 lines: short explanation + file pointer + (where useful) a 2–3 line code/path snippet.

## 3. Agent prompt — `tasks.md` mutation rule

- [x] 3.1 Edit `.claude/agents/fullstack-developer.md` adding a clearly-marked rule inside the existing `## Modo orquestrado (dev-cycle)` section, near the contract-of-output description. Wording target (verbatim): "Você NÃO deve modificar nenhum arquivo que case com `openspec/changes/*/tasks.md`. Marcar tasks `[x]` é responsabilidade exclusiva do orquestrador `/dev-cycle`. Esta regra vale mesmo se a task atual parecer concluída — devolva apenas o `VERDICT: PASS` e deixe o orquestrador atualizar o checkbox." Place the rule on its own line/paragraph with strong visual weight (bullet or bold sentence) so a future prompt refactor cannot remove it accidentally.

## 4. Final validation

- [x] 4.1 `npm run check` → exit 0 (lint + format:check + typecheck)
- [x] 4.2 `npm run test:unit` → exit 0; new `lib/test-utils/mock-gotrue.test.ts` cases included
- [x] 4.3 `npm run test:integration` → exit 0 (no new integration tests; verify no regression)
- [x] 4.4 `npm run test:e2e -- --grep @auth` → exit 0; the `@auth` suite must pass against the relocated helper, proving 1.3/1.4 did not break the runtime path
- [x] 4.5 Manual spot-check: re-read the diff of the agent prompt and confirm the `tasks.md` rule is anchored inside the orchestrated-mode section with strong visual weight
- [x] 4.6 Manual spot-check: open `docs/dev-cycle.md` and confirm `grep -E "NEXT_PUBLIC|webServer|globalSetup|supabase status" docs/dev-cycle.md` returns at least one match per pitfall (per the spec scenario)
