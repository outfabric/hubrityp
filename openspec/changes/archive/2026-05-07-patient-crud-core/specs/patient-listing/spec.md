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

The system SHALL render a "+ Novo Paciente" button prominently in the listing toolbar. Clicking it navigates to the patient creation flow.

#### Scenario: Click create button

- **WHEN** psychologist clicks "+ Novo Paciente"
- **THEN** system navigates to the patient creation form at /app/pacientes/novo
