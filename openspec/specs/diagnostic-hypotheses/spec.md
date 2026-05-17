# diagnostic-hypotheses Specification

## Purpose

Defines the diagnostic hypotheses domain within the electronic medical record: hypothesis CRUD with status lifecycle (investigating/confirmed/discarded), CID-10 autocomplete over ~12k codes via static dataset with fuzzy search, educational warning banner (RF-05.11 — CID-10 in psychology is referential, not a medical diagnosis), mandatory audit logging on every read/write operation, RLS user_id-scoped isolation, CHECK constraint ensuring at least one descriptor, and no hard-deletion (Lei 13.787/2018 retention mandate — hypotheses are discarded via status change only). Created by archiving change `prontuario-diagnostic-hypotheses`.

## Requirements

### Requirement: Psychologist can create a diagnostic hypothesis for a patient

The system SHALL allow psychologists to create diagnostic hypotheses for their patients. Each hypothesis MUST contain at least one of: a free-text description OR a CID-10 code (with its official description). A hypothesis MAY contain both. The initial status MUST default to 'investigating'. The system SHALL write an `audit_log` entry with action='hypothesis.create' on every creation.

#### Scenario: Create hypothesis with CID-10 code

- **WHEN** psychologist submits a new hypothesis with cid10_code='F32.0' and cid10_description='Episodio depressivo leve'
- **THEN** system persists the hypothesis with status='investigating', created_at=now, user_id=auth.uid(), and writes an audit_log row

#### Scenario: Create hypothesis with free-text description only

- **WHEN** psychologist submits a new hypothesis with description='Tracos de ansiedade social' and no CID-10 code
- **THEN** system persists the hypothesis with status='investigating' and writes an audit_log row

#### Scenario: Create hypothesis with both CID-10 and description

- **WHEN** psychologist submits a hypothesis with cid10_code='F41.1', cid10_description='Ansiedade generalizada', and description='Correlacao com estressores laborais'
- **THEN** system persists both fields and writes an audit_log row

#### Scenario: Reject hypothesis with neither description nor CID-10

- **WHEN** psychologist submits a hypothesis with both description and cid10_code null/empty
- **THEN** system rejects the submission with a validation error and does not persist any row

### Requirement: Psychologist can update a diagnostic hypothesis

The system SHALL allow the owning psychologist to update a hypothesis's description, CID-10 code, status, and notes. The "at least one of description/cid10_code" constraint MUST still hold after update. The system SHALL write an `audit_log` entry with action='hypothesis.update' on every update.

#### Scenario: Update hypothesis description

- **WHEN** psychologist updates an existing hypothesis's description to a new value
- **THEN** system persists the change, sets updated_at=now, and writes an audit_log row

#### Scenario: Update rejects clearing both description and CID-10

- **WHEN** psychologist attempts to clear both description and cid10_code on an existing hypothesis
- **THEN** system rejects the update with a validation error

### Requirement: Psychologist can transition hypothesis status

The system SHALL allow the owning psychologist to change a hypothesis status between 'investigating', 'confirmed', and 'discarded'. Transitioning to 'discarded' MUST accept an optional notes field explaining the reason. The system SHALL write an `audit_log` entry with action='hypothesis.status-change' on every status transition.

#### Scenario: Confirm a hypothesis

- **WHEN** psychologist changes hypothesis status from 'investigating' to 'confirmed'
- **THEN** system updates the status, sets updated_at=now, and writes an audit_log row with metadata including old_status and new_status

#### Scenario: Discard a hypothesis with reason

- **WHEN** psychologist changes hypothesis status to 'discarded' with notes='Hipotese descartada apos reavaliacao'
- **THEN** system updates the status and notes, sets updated_at=now, and writes an audit_log row

#### Scenario: Discard a hypothesis without reason

- **WHEN** psychologist changes hypothesis status to 'discarded' without providing notes
- **THEN** system updates the status (notes remains unchanged), sets updated_at=now, and writes an audit_log row

### Requirement: Psychologist can list hypotheses for a patient

The system SHALL return all non-discarded hypotheses (and optionally discarded ones via filter) for a given patient owned by the requesting psychologist, ordered by created_at DESC. The system SHALL write an `audit_log` entry with action='hypothesis.read' on list access.

#### Scenario: List hypotheses returns only owning psychologist's data

- **WHEN** psychologist A requests hypotheses for patient P (owned by psychologist A)
- **THEN** system returns all hypotheses for patient P created by psychologist A

#### Scenario: List hypotheses respects RLS isolation

- **WHEN** psychologist B requests hypotheses for patient P (owned by psychologist A)
- **THEN** system returns an empty list (RLS blocks cross-user access)

#### Scenario: List hypotheses default excludes discarded

- **WHEN** psychologist requests hypotheses without specifying status filter
- **THEN** system returns hypotheses with status 'investigating' or 'confirmed', ordered by created_at DESC

#### Scenario: List hypotheses with all statuses

- **WHEN** psychologist requests hypotheses with includeDiscarded=true
- **THEN** system returns all hypotheses including those with status='discarded'

### Requirement: CID-10 search returns matching codes from static dataset

The system SHALL provide a CID-10 search function that performs accent-insensitive, case-insensitive fuzzy matching against ~12k codes (code prefix match and description substring). Results SHALL be limited to a configurable maximum (default 20). The search operates on a static JSON file built from the official Datasus CSV.

#### Scenario: Search by code prefix

- **WHEN** user searches for 'F32'
- **THEN** system returns all codes starting with 'F32' (e.g., F32.0, F32.1, F32.2, ...) up to the limit

#### Scenario: Search by description substring

- **WHEN** user searches for 'depressao'
- **THEN** system returns codes whose description contains 'depressao' (accent-insensitive: matches 'Depressão')

#### Scenario: Search is accent-insensitive

- **WHEN** user searches for 'ansiedade'
- **THEN** system returns the same results as searching for 'Ansiedade' or 'ANSIEDADE'

#### Scenario: Empty query returns empty array

- **WHEN** user searches with an empty string
- **THEN** system returns an empty array (no results)

#### Scenario: Result count respects limit

- **WHEN** user searches for 'F' with limit=5
- **THEN** system returns at most 5 results

### Requirement: RLS enforces user_id-scoped access on diagnostic_hypotheses

The system SHALL enable RLS on `diagnostic_hypotheses` with per-operation policies: SELECT, INSERT, UPDATE — all scoped via `user_id = auth.uid()`. There SHALL be no DELETE policy (Lei 13.787/2018 retention mandate — hypotheses are discarded via status change, never hard-deleted).

#### Scenario: Owner can SELECT own hypotheses

- **WHEN** psychologist queries diagnostic_hypotheses
- **THEN** only rows where user_id matches the psychologist's auth.uid() are returned

#### Scenario: Owner can INSERT with own user_id

- **WHEN** psychologist inserts a hypothesis with user_id = auth.uid()
- **THEN** the insert succeeds

#### Scenario: INSERT with different user_id is rejected

- **WHEN** an authenticated user attempts to insert a hypothesis with a user_id different from auth.uid()
- **THEN** the insert is rejected by RLS

#### Scenario: No DELETE is possible

- **WHEN** any user attempts to DELETE from diagnostic_hypotheses
- **THEN** the operation is rejected (no DELETE policy exists)

#### Scenario: Cross-psychologist access is blocked

- **WHEN** psychologist B attempts to SELECT hypotheses belonging to psychologist A
- **THEN** zero rows are returned

### Requirement: CHECK constraint ensures at least one descriptor

The system SHALL enforce at database level that each hypothesis row has at least one of `description` or `cid10_code` non-null via a CHECK constraint. This prevents data corruption even if application-layer validation is bypassed.

#### Scenario: Insert with both null is rejected at DB level

- **WHEN** a row is inserted with both description=NULL and cid10_code=NULL (bypassing application validation)
- **THEN** the database rejects the insert with a CHECK constraint violation

#### Scenario: Insert with only description succeeds

- **WHEN** a row is inserted with description='text' and cid10_code=NULL
- **THEN** the insert succeeds

#### Scenario: Insert with only cid10_code succeeds

- **WHEN** a row is inserted with description=NULL and cid10_code='F32'
- **THEN** the insert succeeds

### Requirement: Educational warning banner is displayed per RF-05.11

The system SHALL display a persistent informational banner at the top of the "Hipoteses Diagnosticas" tab with the exact text: "Hipotese diagnostica em psicologia tem natureza de orientacao clinica, nao de diagnostico medico. CID-10 e referencial." The banner MUST use the info semantic variant (info-50 bg, info-700 text, Info icon).

#### Scenario: Banner is visible on tab load

- **WHEN** psychologist navigates to the "Hipoteses Diagnosticas" tab
- **THEN** the educational banner is displayed prominently above the hypothesis list

#### Scenario: Banner is not dismissible

- **WHEN** psychologist views the banner
- **THEN** there is no close/dismiss button (the banner is always visible as an ethical reminder)

### Requirement: Audit log records every hypothesis read and write

The system SHALL write an `audit_log` row on every hypothesis operation: create (action='hypothesis.create'), update (action='hypothesis.update'), status change (action='hypothesis.status-change'), and list/read (action='hypothesis.read'). Each entry MUST include user_id from session, resource_type='diagnostic_hypothesis', resource_id=hypothesis_id (or patient_id for list), and ip_address when available.

#### Scenario: Audit log on hypothesis creation

- **WHEN** psychologist creates a hypothesis
- **THEN** an audit_log row is written with action='hypothesis.create', resource_type='diagnostic_hypothesis', resource_id=new_hypothesis_id

#### Scenario: Audit log on hypothesis list

- **WHEN** psychologist views the hypotheses tab for a patient
- **THEN** an audit_log row is written with action='hypothesis.read', resource_type='diagnostic_hypothesis', resource_id=patient_id

#### Scenario: Audit log on status change

- **WHEN** psychologist changes a hypothesis status
- **THEN** an audit_log row is written with action='hypothesis.status-change', metadata containing {old_status, new_status}
