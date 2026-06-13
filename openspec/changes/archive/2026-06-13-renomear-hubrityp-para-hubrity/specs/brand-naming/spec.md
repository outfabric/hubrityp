## ADDED Requirements

### Requirement: User-facing product name is "Hubrity"

The system SHALL refer to the product as "Hubrity" in all user-facing text — never "HubrityP". This applies to HTML metadata titles, UI copy, transactional email content, and generated PDFs. In running prose the name uses an initial capital ("Hubrity") as a proper noun.

#### Scenario: No user-facing surface shows "HubrityP"

- **WHEN** any user-facing surface in scope (metadata titles, auth/dashboard copy, public-layout footers, transactional emails, exported PDFs) is rendered
- **THEN** the visible/declared text contains "Hubrity" and contains no occurrence of the string "HubrityP"

### Requirement: Root metadata title uses "Hubrity"

The system SHALL set the base application title in `src/app/layout.tsx` to "Hubrity", and the public token-gated layouts (`termo`, `escala`, `confirmar-sessao`, `v/[token]`) SHALL use "Hubrity" in their `title` metadata.

#### Scenario: Base title is "Hubrity"

- **WHEN** the root layout metadata is resolved
- **THEN** the document title is "Hubrity" (not "HubrityP")

#### Scenario: Public layout title uses "Hubrity"

- **WHEN** a public token page (e.g. `/termo/:token`) resolves its metadata
- **THEN** the title reads "… — Hubrity" (not "… — HubrityP")

### Requirement: UI copy refers to the product as "Hubrity"

The system SHALL use "Hubrity" in user-facing copy strings: the login and signup card descriptions, the dashboard welcome message, and the institutional footer caption of the public layouts.

#### Scenario: Auth copy uses "Hubrity"

- **WHEN** the login or signup page renders its description
- **THEN** the text refers to "Hubrity" (e.g. "Acesse sua conta Hubrity.") and not "HubrityP"

#### Scenario: Public footer uses "Hubrity"

- **WHEN** a public token layout renders its footer caption
- **THEN** the caption reads "Hubrity — Plataforma para psicólogos"

### Requirement: Transactional emails use "Hubrity"

The system SHALL use "Hubrity" as the sender display name and in the body/sign-off of transactional emails, and the sender address SHALL use the `hubrity.com` domain (`noreply@hubrity.com`).

#### Scenario: Sender display name and domain use Hubrity

- **WHEN** a transactional email is dispatched via the default sender
- **THEN** the `From` value is `Hubrity <noreply@hubrity.com>` (display name "Hubrity", domain `hubrity.com`, no "HubrityP" and no `hubrityp.com`)

#### Scenario: Email sign-off uses "Hubrity"

- **WHEN** an account-locked, password-changed, or NPS-detractor email is rendered (HTML and plain-text parts)
- **THEN** the sign-off reads "— Equipe Hubrity" and any body reference uses "Hubrity"

### Requirement: Generated PDFs use "Hubrity"

The system SHALL use "Hubrity" in the footer/sign-off of generated PDFs (e.g. the medical-records export).

#### Scenario: PDF footer uses "Hubrity"

- **WHEN** a medical-records PDF is generated
- **THEN** its footer reads "— Equipe Hubrity" and contains no "HubrityP"

### Requirement: Canonical domain is "hubrity.com"

The system SHALL use `hubrity.com` as the canonical domain — both for the email sender (`noreply@hubrity.com`) and for the application (`app.hubrity.com`), replacing the legacy `hubrityp.com` / `hubrityp.com.br`. In runtime code the application URL is sourced from the `APP_URL` environment variable; hardcoded occurrences in comments, examples, placeholders, and test fixtures SHALL be updated to `hubrity.com` for consistency. Production traffic depends on out-of-code infrastructure (DNS, Vercel domain + `APP_URL`, Resend domain verification, Twilio webhook URLs) being cut over to `hubrity.com`; this dependency SHALL be tracked explicitly rather than assumed complete by the code edit alone.

#### Scenario: No code reference uses the legacy domain

- **WHEN** the change is applied
- **THEN** no source or test file references `hubrityp.com` or `hubrityp.com.br`; references use `hubrity.com`

#### Scenario: Application URL comes from APP_URL, not hardcoded strings

- **WHEN** the application builds an absolute patient-facing link at runtime
- **THEN** it derives the host from the `APP_URL` environment variable, and the hardcoded domain strings exist only as comments/examples/fixtures

#### Scenario: Infrastructure cutover is tracked, not assumed

- **WHEN** the domain rename is implemented in code
- **THEN** the DNS / Vercel / Resend / Twilio cutover to `hubrity.com` is recorded as an explicit prerequisite rather than treated as resolved by the code change

### Requirement: Non-domain internal identifiers are out of scope

The system's non-user-facing, non-domain identifiers (the npm package name, internal dev hostnames) are NOT renamed by this capability. Image wordmark assets are already updated to the new brand and require no action here.

#### Scenario: Package identifier is untouched

- **WHEN** the rename is applied
- **THEN** internal identifiers such as the npm package name are left unchanged (only user-facing text and the domain change)
