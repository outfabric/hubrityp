## Context

HubrityP targets Brazilian psychologists, but ~151 files carry user-facing copy with missing diacritics/cedillas (~360+ occurrences across 7 surfaces). The errors are accidental and inconsistent — correct and broken spellings coexist in the same files — so there is no convention to preserve, only mistakes to fix. The change is purely textual (no logic, schema, route, RLS, or API-contract changes) but is **cross-cutting** and contains three traps that make a naive find-replace dangerous:

1. Stored enum values (`['declaracao','atestado','relatorio','laudo','parecer']`) are backed by a Postgres `CHECK` constraint — accenting them breaks the data contract.
2. URL/route segments (`/pacientes`, `/configuracoes`, `/transcricoes`, `/confirmar-sessao`, `/sessao`, `/caixa-de-entrada`) are intentionally ASCII — accenting them breaks links.
3. ~40 e2e/integration assertions are coupled to the misspelled strings — fixing copy without them turns the suite red.

No spell-check guard exists today, so any fix regresses on the next PR.

## Goals / Non-Goals

**Goals:**
- Correct diacritics/cedillas in all user-facing display copy across the 7 surfaces.
- Update coupled test assertions in lockstep so suites stay green.
- Add a durable cspell guard (pt-BR dict + allowlist) wired into lint/CI to make the audit exhaustive and prevent regression.
- Keep stored enum tokens, route segments, and identifiers untouched.

**Non-Goals:**
- Rewording or restructuring any copy (this is orthography only).
- Producing canonical validated wording for clinical scales (AUDIT/SDQ) — deferred to clinical review via `TODO(clinical-review)` markers.
- Translating, adding i18n infrastructure, or changing any non-display string.
- Any data migration, schema, route, RLS, auth, or API change.

## Decisions

**D1 — Slice per module, not one big sweep.** Each slice corrects one module's copy *and* its coupled tests together. Rationale: the 40 test assertions are the binding constraint; pairing copy+tests per module keeps each `/dev-cycle` section independently green and reviewable. Alternative (single bundled change) rejected — a 151-file diff is unreviewable and any test miss reddens the whole suite at once.

**D2 — Fix by hand/targeted edits, not a global regex replace.** A blind `sed` across the repo would hit enum tokens, routes, and identifiers (traps #1–#2). Corrections are scoped to display contexts (JSX text, copy attributes, message/label/subject strings). The cspell guard (D4) is the safety net that proves completeness after the manual pass. Alternative (scripted accent map) rejected as too blunt for the do-not-touch boundaries.

**D3 — cspell runs last, as the closer.** Running the guard after the per-module fixes (a) validates the cleanup, (b) surfaces words the manual audit's regex never enumerated, and (c) the allowlist authoring forces an explicit decision on every remaining ASCII token (intentional vs. bug). Alternative (guard first) rejected — it would flood with the very errors we're about to fix and provide no completeness signal.

**D4 — Allowlist is a first-class artifact.** The cspell config gets a pt-BR dictionary plus a project dictionary/allowlist enumerating intentional ASCII: route segments, enum tokens (`declaracao`/`atestado`/`relatorio`/`laudo`/`parecer`/`cancelled`/…), identifiers, and vendor/technical terms (Twilio, Asaas, Inngest, Drizzle, Supabase, Gemini, PIX, CRP, CPF, LGPD, etc.). This encodes "this ASCII is intentional" durably so the guard never fights the traps.

**D5 — Clinical scales: diacritics only + review marker.** AUDIT/SDQ are validated instruments; ad-hoc rewording could change clinical meaning. We add only unambiguous diacritics and leave a grep-able `TODO(clinical-review)` per touched item so the canonical-wording pass has a trail. Alternative (fix to "official" wording now) rejected — we lack the verified canonical source in-repo.

**D6 — cspell scope is the user-facing source tree.** Point cspell at `src/**` (TS/TSX), excluding generated/migration/lockfiles and the `meta/` drizzle output. This maximizes signal while the allowlist absorbs unavoidable technical noise.

## Risks / Trade-offs

- **[Accidentally accenting a stored enum token]** → Do-not-touch list baked into the spec; enum tokens added to the cspell allowlist; reviewer/PR checklist calls out enum/route boundaries; no migration touched.
- **[Accidentally accenting a route segment → broken links/404]** → Route segments enumerated in spec + allowlist; e2e suite (which navigates real URLs) catches a broken route.
- **[Missed test assertion → red suite]** → Per-module slicing pairs copy+tests; the `/dev-cycle` per-section run plus end-of-change sweep exercise integration + e2e in full.
- **[Manual audit misses occurrences my regex never enumerated]** → cspell closer (D3) is precisely the exhaustiveness backstop; it must pass clean over slices 1–8.
- **[Allowlist over-broad, masking real typos]** → Keep the allowlist to proper nouns/technical tokens and explicit enum/route tokens; do not allowlist common words that have a correct accented form.
- **[cspell flags legitimate pt-BR words absent from its dictionary]** → Use a maintained pt-BR dictionary; add genuine domain words (clinical terms) to the project dictionary, distinct from the intentional-ASCII allowlist.

## Migration Plan

Not a data migration — code/text only. Rollout is the normal per-section `/dev-cycle` flow:

1. Slices 1–7: per-module copy + coupled test fixes (each independently validated and green).
2. Slice 8: clinical scales — diacritics only + `TODO(clinical-review)` markers.
3. Slice 9: add cspell dep + config + allowlist + `npm run spell`; wire into lint/CI; run until clean over the whole tree, fixing any residual misses it surfaces.
4. CI pipeline (`ci-pipeline`) gains the spell step so future PRs are guarded.

**Rollback:** revert the relevant slice commit(s); no stateful change, so rollback is trivial and side-effect-free.

## Open Questions

- Exact cspell pt-BR dictionary package to adopt (`@cspell/dict-pt-br` vs. alternative) — resolve during slice 9 via Context7/npm.
- Whether the spell step should be `blocking` in CI from day one or `warn`-then-`block` after the first green run (lean: blocking, since slices 1–8 land it clean).
- Canonical AUDIT/SDQ pt-BR source for the deferred clinical-review pass (owner: clinical reviewer, outside this change).
