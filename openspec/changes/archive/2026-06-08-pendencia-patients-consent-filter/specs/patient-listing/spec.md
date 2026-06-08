## ADDED Requirements

### Requirement: Listing supports the dashboard consent pendência filter

The system SHALL interpret a `filtro` search param on `/pacientes` against a closed allowlist whose only MVP value is `sem-consentimento`. When `filtro=sem-consentimento`, the listing SHALL restrict results to patients matching the **same predicate used by the dashboard count** — `consent_signed_at IS NULL AND archived_at IS NULL`, scoped to `user_id = auth.uid()` — applied server-side in `listPatientsImpl` (not reimplemented in the page). Any other `filtro` value (unknown, empty, or array) SHALL be ignored and the default full listing SHALL render with no error and no blank screen. The filter is applied on the first server render, before pagination, with no flash of the unfiltered list. The `filtro` value is validated server-side as defense against URL-injected filters and never widens the owner scope.

#### Scenario: Consent filter restricts to the count predicate
- **GIVEN** the psychologist has 3 active patients with `consent_signed_at IS NULL` and other patients who already signed
- **WHEN** the page loads at `/pacientes?filtro=sem-consentimento`
- **THEN** only the 3 patients without consent (and not archived) are listed
- **AND** patients with a signed consent or `archived_at` set are excluded

#### Scenario: Filter composes with existing params before pagination
- **GIVEN** more than 25 patients without consent and a search term that matches a subset
- **WHEN** the page loads at `/pacientes?filtro=sem-consentimento&search=ana&page=1`
- **THEN** the result is the intersection of the consent predicate and the search, paginated at 25 per page
- **AND** the total/page count reflects the filtered set, not the full list

#### Scenario: Unknown filter value degrades to the full list
- **WHEN** the page loads at `/pacientes?filtro=xyz` (or `?filtro=` empty, or `filtro` repeated as an array)
- **THEN** the default full listing renders with no error
- **AND** no filter outside the allowlist is applied

#### Scenario: Archived status combined with consent filter yields the empty set
- **WHEN** the page loads at `/pacientes?filtro=sem-consentimento&status=archived`
- **THEN** the result is empty, because archived patients are excluded from the consent predicate
- **AND** the positive empty state is shown (not the full list)

### Requirement: Consent filter shows a removable active-filter indicator

When `filtro=sem-consentimento` is active, the listing SHALL display a removable chip/badge indicating the active filter together with the filtered count (e.g. "Sem consentimento · N"). The chip SHALL be announceable by a screen reader and removable by keyboard. Removing it SHALL clear the `filtro` param from the URL and return to the full listing.

#### Scenario: Active-filter chip reflects the filtered count
- **GIVEN** 4 patients without consent
- **WHEN** the page loads at `/pacientes?filtro=sem-consentimento`
- **THEN** a chip reading the active filter with count 4 is visible and exposed to assistive technology

#### Scenario: Removing the chip returns to the full list
- **GIVEN** the consent filter is active
- **WHEN** the psychologist activates the chip's remove control (click or keyboard)
- **THEN** the URL no longer contains `filtro=sem-consentimento`
- **AND** the full patient listing is shown

#### Scenario: Filtered header count matches the dashboard pendência
- **GIVEN** the dashboard Pendências section shows N patients without consent for the user
- **WHEN** the user opens `/pacientes?filtro=sem-consentimento` at the same instant
- **THEN** the filtered listing's count equals N (same source-of-truth predicate)

### Requirement: Consent-filtered rows expose copy-link and WhatsApp share actions

When the consent filter is active, each patient row SHALL offer two consent-share actions that reuse the existing consent capability. **Copiar link do termo** SHALL copy the token-gated `/termo/{token}` URL to the clipboard with visual "copiado" feedback; if the patient has no pending term, the action SHALL first generate one via the existing `generateConsent` Server Action, reusing the existing pending token without creating a duplicate, then copy the link. **Enviar por WhatsApp** SHALL open a `wa.me` click-to-chat link with the message pre-filled via `buildConsentWhatsAppHref(phone, consentUrl)`, using the **guardian's phone when the patient is a minor** (`child` or `adolescent`). The pre-filled message SHALL contain only the consent link, no clinical data. The token-gated link SHALL NOT be logged in full.

#### Scenario: Copy link generates and reuses a pending token
- **GIVEN** a consent-filtered patient with no pending consent term
- **WHEN** the psychologist clicks "Copiar link do termo"
- **THEN** a pending term is generated once (reusing an existing pending token on subsequent clicks, never duplicating)
- **AND** the `/termo/{token}` URL is written to the clipboard with "copiado" feedback

#### Scenario: WhatsApp uses the patient's phone for an adult
- **GIVEN** an adult consent-filtered patient with a phone number
- **WHEN** the psychologist clicks "Enviar por WhatsApp"
- **THEN** a `wa.me` link opens for the patient's phone digits with the message containing the `/termo/{token}` URL

#### Scenario: WhatsApp uses the guardian's phone for a minor
- **GIVEN** a `child`/`adolescent` consent-filtered patient whose primary guardian has a phone
- **WHEN** the psychologist clicks "Enviar por WhatsApp"
- **THEN** the `wa.me` link targets the guardian's phone digits, not the patient's

### Requirement: WhatsApp action is disabled without an available phone

When no phone is available — neither the patient's, nor the guardian's for a minor — the row's "Enviar por WhatsApp" action SHALL be disabled with an explanatory tooltip ("Cadastre um telefone para enviar pelo WhatsApp"), while "Copiar link do termo" SHALL remain available as the fallback.

#### Scenario: Adult without phone disables only WhatsApp
- **GIVEN** an adult consent-filtered patient with no phone
- **WHEN** the row renders
- **THEN** "Enviar por WhatsApp" is disabled with the explanatory tooltip
- **AND** "Copiar link do termo" remains enabled

#### Scenario: Minor without guardian phone disables only WhatsApp
- **GIVEN** a minor consent-filtered patient whose guardian has no phone (or no guardian linked)
- **WHEN** the row renders
- **THEN** "Enviar por WhatsApp" is disabled with the explanatory tooltip
- **AND** "Copiar link do termo" remains enabled

### Requirement: Consent filter shows a positive empty state and stays owner-scoped

When the consent filter resolves to zero patients (the pendência was resolved or expired between the dashboard load and the click), the listing SHALL show a positive, specific empty state — "Nenhum paciente sem consentimento pendente." — with a link to the full patient list, never the unexplained full list. No `filtro` or other URL value SHALL ever expose another psychologist's patients.

#### Scenario: Empty filtered set shows the positive state
- **GIVEN** the user has zero patients matching the consent predicate
- **WHEN** the page loads at `/pacientes?filtro=sem-consentimento`
- **THEN** the empty state "Nenhum paciente sem consentimento pendente." is shown with a link to the full list

#### Scenario: Cross-tenant scope is enforced
- **GIVEN** psychologist A and psychologist B each have patients without consent
- **WHEN** A loads `/pacientes?filtro=sem-consentimento` (under any combination of URL params)
- **THEN** only A's patients appear; none of B's rows are ever returned

#### Scenario: Anonymous deep-link is redirected
- **WHEN** an anonymous request hits `/pacientes?filtro=sem-consentimento`
- **THEN** middleware redirects to `/login`
