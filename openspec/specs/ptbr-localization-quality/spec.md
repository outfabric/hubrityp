### Requirement: User-facing copy uses correct Brazilian-Portuguese orthography

All text rendered to users SHALL use correct Brazilian-Portuguese orthography, including mandatory diacritics (acute, grave, circumflex, tilde) and cedillas. This applies to every user-facing surface: JSX text nodes, `placeholder`/`aria-label`/`title` attributes, Sonner toast messages, Zod validation messages, generated-PDF metadata (Subject/Title) and body copy, page metadata (`<title>` and `description`), human-readable label maps, and transactional email subjects and bodies.

#### Scenario: Display copy carries required diacritics

- **WHEN** a user views any page, dialog, toast, validation error, generated PDF, or email produced by the application
- **THEN** every Portuguese word that requires a diacritic or cedilla is rendered with it (e.g. `não`, `sessão`, `configuração`, `você`, `código`, `histórico`, `análise`), with no remaining ASCII-only spellings of those words in display copy

#### Scenario: Human-readable label maps are corrected

- **WHEN** a value is shown to the user through a label map (e.g. `DOCUMENT_TYPE_LABELS` rendering a document type)
- **THEN** the displayed label is correctly accented (e.g. `Laudo Psicológico`, `Atestado Psicológico`, `Parecer Psicológico`)

### Requirement: Intentional ASCII identifiers are preserved

The correction SHALL NOT alter non-display strings whose ASCII form is semantically significant. Stored enum/literal token values, URL/route segments, variable/function/property identifiers, import paths, CSS class names, and status tokens MUST remain unchanged.

#### Scenario: Stored enum tokens are not accented

- **WHEN** correcting copy near the document-type tokens `declaracao`, `atestado`, `relatorio`, `laudo`, `parecer`
- **THEN** the stored enum/literal values and the database `CHECK` constraint remain byte-for-byte unchanged, and only the surrounding human-readable prose/labels are accented

#### Scenario: Route segments and identifiers are not accented

- **WHEN** correcting files that reference URL segments (`/pacientes`, `/configuracoes`, `/transcricoes`, `/confirmar-sessao`, `/sessao`, `/caixa-de-entrada`), code identifiers, import paths, CSS classes, or status tokens such as `cancelled`
- **THEN** those tokens are left unchanged, so URLs resolve and code continues to compile and run

### Requirement: Coupled tests are updated in lockstep

Automated tests that assert on user-facing copy SHALL be updated to the corrected strings within the same unit of work that corrects the copy, so the suite remains green.

#### Scenario: Test assertions match corrected copy

- **WHEN** a module's display copy is corrected and that copy is asserted by an e2e or integration test (e.g. `getByText('Sessao cancelada')`)
- **THEN** the corresponding assertion is updated to the corrected string (e.g. `getByText('Sessão cancelada')`) and the relevant test suites pass

### Requirement: Clinical psychometric scales are corrected conservatively

Validated clinical instruments (e.g. AUDIT, SDQ) SHALL have only unambiguous diacritics corrected; their phrasing MUST NOT be reworded. Each corrected scale item MUST carry a marker indicating that canonical validated wording still requires clinical review.

#### Scenario: Scale diacritics fixed without rewording

- **WHEN** correcting a clinical scale item (e.g. `Com que frequencia, durante o ultimo ano, voce ...`)
- **THEN** only diacritics are added (`Com que frequência, durante o último ano, você ...`), the sentence structure and wording are unchanged, and a `TODO(clinical-review)` marker is present for the canonical-wording verification

### Requirement: Automated spell-check guard prevents regression

The project SHALL include an automated Brazilian-Portuguese spell-check guard (cspell with a pt-BR dictionary) exposed as an npm script and enforced in the lint/CI pipeline. An allowlist/custom dictionary SHALL encode the intentional ASCII tokens (route segments, enum tokens, identifiers, vendor/technical terms) so the guard does not flag them.

#### Scenario: Guard passes clean on corrected codebase

- **WHEN** the spell-check script runs against the corrected codebase
- **THEN** it reports no Brazilian-Portuguese spelling errors and exits successfully

#### Scenario: Guard fails on a newly introduced misspelling

- **WHEN** a change introduces a user-facing Portuguese word missing a required diacritic (e.g. `sessao`) that is not on the allowlist
- **THEN** the spell-check script reports the error and fails, blocking the regression in CI

#### Scenario: Allowlisted ASCII tokens do not trip the guard

- **WHEN** the spell-check script encounters intentional ASCII tokens such as route segments or stored enum values
- **THEN** those tokens are recognized via the allowlist/custom dictionary and produce no error
