## Why

The platform's audience is Brazilian psychologists, yet user-facing copy across ~151 files contains hundreds of words missing mandatory Brazilian-Portuguese diacritics and cedillas (`nao`→`não`, `sessao`→`sessão`, `configuracao`→`configuração`, `voce`→`você`). The errors are demonstrably accidental, not a convention — the same files mix correct and broken forms (`'Análise é obrigatória'` sits three lines from `'Descricao obrigatoria'`). This reads as unprofessional to clinical users and, in generated documents (PDFs, exports) and clinical instruments, undermines trust. Nothing in the toolchain prevents the next PR from re-introducing the same errors.

## What Changes

- Correct missing diacritics/cedillas in **user-facing display copy** across 7 surfaces: JSX text/placeholders/aria-labels, Sonner toasts, Zod validation messages, PDF metadata (Subject/Title), page metadata (`<title>`/description), human-readable label maps (e.g. `DOCUMENT_TYPE_LABELS`), and email templates. Work is sliced **per module** (agenda, medical-records, telepsicologia, patients, whatsapp, sessions, auth/onboarding/oauth).
- Update the **~40 test assertions** (e2e/integration) that are coupled to the misspelled strings, in lockstep with each module's copy fix, so the suite stays green.
- Clinical psychometric scales (AUDIT, SDQ): fix **only unambiguous diacritics**; leave a `TODO(clinical-review)` marker on each touched item, because canonical validated wording requires human clinical review (out of scope here).
- Add a **cspell guard** (new capability): cspell + pt-BR dictionary, an npm script, a lint/CI hook, and an **allowlist** encoding intentional ASCII (route segments, stored enum tokens, identifiers, vendor terms). Run last; it must pass clean over all corrected slices and surfaces words the manual audit missed.
- **Do-not-touch boundaries** (must NOT be accented): stored enum values `['declaracao','atestado','relatorio','laudo','parecer']` (DB `CHECK` constraint), URL/route segments (`/pacientes`, `/configuracoes`, `/transcricoes`, `/confirmar-sessao`, `/sessao`, `/caixa-de-entrada`), variable/function/object-key identifiers, import paths, CSS classes, and status tokens (e.g. `'cancelled'`).

## Capabilities

### New Capabilities
- `ptbr-localization-quality`: Establishes the requirement that all user-facing copy use correct Brazilian-Portuguese orthography (diacritics/cedillas), defines the surfaces in scope and the ASCII boundaries that must stay unaccented, and mandates an automated spell-check guard (cspell + pt-BR dictionary + allowlist) enforced in CI to prevent regression.

### Modified Capabilities
<!-- None. This change corrects literal copy strings (implementation detail) without altering the behavioral requirements of any existing capability. -->

## Impact

- **Code**: ~151 files under `src/app`, `src/modules`, `src/shared` (display copy only). Heaviest: `agenda` and `medical-records`. No logic, schema, route, RLS, or API-contract changes.
- **Tests**: ~40 coupled assertions in `src/__tests__/e2e/seeded/**` and integration suites updated to the corrected strings.
- **Tooling**: new dev dependency `cspell` + config (`cspell.json`/`.cspell`), an allowlist/custom-dictionary file, an `npm run spell` script, and a wiring into the lint step / CI pipeline (`ci-pipeline`).
- **Risk / boundaries**: must not alter stored enum tokens, URL segments, or identifiers (see do-not-touch list). Clinical-scale canonical wording deferred to clinical review via `TODO(clinical-review)` markers.
- **No** data migration, no user-data changes, no auth/security surface changes.
