## ADDED Requirements

### Requirement: Listing displays patient cards/rows with key information

The system SHALL render a paginated listing of patients showing: photo/initials, full_name, status (Ativo/Arquivado), tags, phone, and email. The listing defaults to showing only active patients.

#### Scenario: Default view shows active patients

- **WHEN** psychologist navigates to /app/pacientes without filters
- **THEN** system displays only patients with status="active", ordered alphabetically by full_name

#### Scenario: Each patient card shows required fields

- **WHEN** listing renders a patient row
- **THEN** the row displays the patient's photo (or initials if no photo), full name, status badge, tags as chips, and phone number

### Requirement: Listing supports server-side pagination

The system SHALL paginate patient results at 25 items per page. Pagination controls (previous/next, page numbers) MUST be rendered. Total count MUST be displayed.

#### Scenario: First page with more than 25 patients

- **WHEN** psychologist has 40 active patients and views the listing
- **THEN** system displays the first 25 patients with pagination showing "1 de 2" and a "Próxima" button

#### Scenario: Navigate to second page

- **WHEN** psychologist clicks "Próxima" on page 1
- **THEN** system displays patients 26-40 with "Anterior" button enabled

### Requirement: Listing supports text search by name, phone, or email

The system SHALL provide a search input that filters patients by partial match on full_name (case-insensitive, accent-insensitive via unaccent), phone, or email. Search MUST return results in under 500ms for up to 200 patients.

#### Scenario: Search by partial name

- **WHEN** psychologist types "mar" in the search input
- **THEN** system filters to patients whose full_name contains "mar" (case-insensitive), e.g., "Maria Silva", "Marcos Lima"

#### Scenario: Search by phone number

- **WHEN** psychologist types "99988" in the search input
- **THEN** system filters to patients whose phone contains "99988"

#### Scenario: Search returns empty state

- **WHEN** psychologist searches for "xyznonexistent"
- **THEN** system displays empty state message "Nenhum paciente encontrado"

### Requirement: Listing supports filter by status

The system SHALL provide a status filter with options: Todos, Ativos (default), Arquivados. Only one option is active at a time.

#### Scenario: Filter by archived patients

- **WHEN** psychologist selects "Arquivados" status filter
- **THEN** system displays only patients with status="archived"

#### Scenario: Filter "Todos" shows all patients

- **WHEN** psychologist selects "Todos" status filter
- **THEN** system displays both active and archived patients

### Requirement: Listing supports filter by tags

The system SHALL provide a multi-select tag filter. When one or more tags are selected, only patients that have ALL selected tags are shown (AND logic).

#### Scenario: Filter by single tag

- **WHEN** psychologist selects tag "TCC"
- **THEN** system displays only patients whose tags array includes "TCC"

#### Scenario: Filter by multiple tags

- **WHEN** psychologist selects tags "TCC" and "infantil"
- **THEN** system displays only patients whose tags array includes both "TCC" AND "infantil"

### Requirement: Listing supports column sorting

The system SHALL allow sorting by full_name (default, ascending). Clicking a column header toggles ascending/descending sort. Active sort is indicated visually.

#### Scenario: Sort by name descending

- **WHEN** psychologist clicks the "Nome" column header (currently sorted ascending)
- **THEN** system re-sorts patients by full_name in descending order (Z→A)

#### Scenario: Default sort is name ascending

- **WHEN** psychologist navigates to listing without sort parameter
- **THEN** patients are sorted alphabetically by full_name (A→Z)

### Requirement: Create patient button is prominently displayed

The system SHALL render a "+ Novo Paciente" button prominently in the listing toolbar. **An "Importar CSV" button SHALL be rendered as a secondary action in the same toolbar.** Clicking "+ Novo Paciente" navigates to the creation form. Clicking "Importar CSV" navigates to the import page.

#### Scenario: Click create button

- **WHEN** psychologist clicks "+ Novo Paciente"
- **THEN** system navigates to the patient creation form at /app/pacientes/novo

#### Scenario: Click import button

- **WHEN** psychologist clicks "Importar CSV"
- **THEN** system navigates to /app/pacientes/importar

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
