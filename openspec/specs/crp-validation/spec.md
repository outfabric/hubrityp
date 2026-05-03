# crp-validation Specification

## Purpose
Define the CRP (Conselho Regional de Psicologia) validation surface of the
platform: the synchronous Zod validators (`crpNumberSchema`, `crpUfSchema`),
the regional code → UF mapping sourced from PRD 01 Apêndice A, the
`crp_validation_queue` table that records each manual review, the admin
Server Actions that approve or reject submissions, and the privacy-by-design
constraint that no card photos are ever stored. Created by archiving change
`add-account-signup-and-lifecycle`.

## Requirements
### Requirement: CRP number format is validated synchronously at the form boundary

The system SHALL validate the CRP number against the pattern `^\d{2}/\d{4,7}$` where the two-digit prefix MUST be one of the regional codes listed in PRD 01 Apêndice A (codes `01` through `24`). Format validation MUST run as a Zod refinement (`crpNumberSchema`) at every entry point — signup form, profile update, admin queue insertion. Invalid format MUST be rejected before any DB write or external call.

#### Scenario: Valid CRP passes the format check

- **WHEN** `crpNumberSchema.safeParse('06/123456')` runs
- **THEN** the result is `{ success: true }`

#### Scenario: Wrong delimiter is rejected

- **WHEN** `crpNumberSchema.safeParse('06-123456')` runs
- **THEN** the result is `{ success: false }` with a message indicating the expected `XX/NNNNNN` format

#### Scenario: Out-of-range regional code is rejected

- **WHEN** `crpNumberSchema.safeParse('99/123456')` runs (99 is not a known regional code)
- **THEN** the result is `{ success: false }` with a message indicating the regional code is unknown

#### Scenario: Inscription number too short is rejected

- **WHEN** `crpNumberSchema.safeParse('06/123')` runs (only 3 digits in the second part)
- **THEN** the result is `{ success: false }`

#### Scenario: Inscription number too long is rejected

- **WHEN** `crpNumberSchema.safeParse('06/12345678')` runs (8 digits in the second part)
- **THEN** the result is `{ success: false }`

### Requirement: CRP UF must be one of the 27 Brazilian UFs

The system SHALL validate `crp_uf` against the closed set of 27 Brazilian state UFs (`AC, AL, AM, AP, BA, CE, DF, ES, GO, MA, MG, MS, MT, PA, PB, PE, PI, PR, RJ, RN, RO, RR, RS, SC, SE, SP, TO`) via a Zod enum (`crpUfSchema`). Any other value MUST be rejected at the form boundary.

#### Scenario: Valid UF passes

- **WHEN** `crpUfSchema.safeParse('SP')` runs
- **THEN** the result is `{ success: true }`

#### Scenario: Lower-case UF is rejected

- **WHEN** `crpUfSchema.safeParse('sp')` runs
- **THEN** the result is `{ success: false }` (the form Client Component is responsible for upper-casing before submit)

#### Scenario: Non-UF string is rejected

- **WHEN** `crpUfSchema.safeParse('XX')` runs
- **THEN** the result is `{ success: false }`

### Requirement: Regional code → UF mapping is sourced from PRD 01 Apêndice A

The system SHALL expose the mapping from CRP regional code to UF as a typed constant in `src/modules/crp-validation/lib/regional-codes.ts`, matching PRD 01 Apêndice A exactly. Consumers MUST use this constant — duplicating the mapping is forbidden.

#### Scenario: Regional code 06 maps to SP

- **WHEN** `regionalCodeToUf('06')` is called
- **THEN** the result is `'SP'`

#### Scenario: Unknown regional code returns null

- **WHEN** `regionalCodeToUf('99')` is called
- **THEN** the result is `null`

#### Scenario: Constant covers all PRD-01 codes

- **WHEN** the test suite enumerates the constant
- **THEN** every PRD 01 Apêndice A code (`01` through `24`) has a UF mapping

### Requirement: `(crp_number, crp_uf)` is unique across psychologists

The system SHALL enforce uniqueness on the pair `(crp_number, crp_uf)` in `psychologist_profiles` via a database UNIQUE constraint, satisfying RN-01.02.

#### Scenario: Duplicate CRP/UF is rejected

- **GIVEN** a `psychologist_profiles` row with `crp_number='06/123456', crp_uf='SP'`
- **WHEN** a signup attempt tries to insert another profile with the same pair
- **THEN** Postgres returns a UNIQUE violation
- **AND** the `signUp` Server Action surfaces this as `{ ok: false, error: 'crp_already_registered' }`

#### Scenario: Same number with different UF is allowed

- **GIVEN** an existing profile with `crp_number='06/123456', crp_uf='SP'`
- **WHEN** a different psychologist registers `crp_number='06/123456', crp_uf='RJ'`
- **THEN** the insertion succeeds (the regional code embedded in the number is independently meaningful, but the system does not enforce cross-field consistency at this layer)

### Requirement: `crp_validation_queue` table records each manual review request

The system SHALL persist each manual CRP review in a `crp_validation_queue` table with at least these columns: `id` (UUID PK), `user_id` (FK → `auth.users.id`), `crp_number`, `crp_uf`, `status` (one of `pending`, `approved`, `rejected`), `submitted_at`, `decided_at`, `decided_by` (admin user id, nullable until decided), `rejection_reason` (nullable text). RLS MUST forbid non-admin users from reading the queue.

#### Scenario: Signup enqueues a pending review

- **WHEN** a signup completes and the profile lands in `pending_crp_validation`
- **THEN** a `crp_validation_queue` row exists with `status='pending'`, `user_id` matching the new profile, the submitted `crp_number` and `crp_uf`, `submitted_at=NOW()`, and `decided_at=NULL`

#### Scenario: Non-admin cannot read the queue

- **GIVEN** a regular psychologist's session
- **WHEN** they query `select * from crp_validation_queue`
- **THEN** the result is empty (RLS denies the read)

#### Scenario: Admin sees pending entries

- **GIVEN** an admin role session
- **WHEN** they query the queue with `status='pending'`
- **THEN** they see all unresolved submissions

### Requirement: Admin approval transitions the account to `active`

The system SHALL expose an admin Server Action `approveCrpValidation(queueId)` that, when invoked by an admin role, marks the queue row `status='approved'`, sets `decided_at=NOW()` and `decided_by=<admin>`, and emits a `crp_approved` event into `transitionStatus` for the corresponding `user_id`. The transition MUST move the account from `pending_crp_validation` to `active`.

#### Scenario: Approval activates the account

- **GIVEN** a queue row in `pending` for a user in `pending_crp_validation`
- **WHEN** an admin invokes `approveCrpValidation(queueId)`
- **THEN** the queue row's `status` becomes `approved`, `decided_at` and `decided_by` are populated, and the user's profile `status` becomes `active` in the same transaction

#### Scenario: Approval is rejected for non-admin callers

- **WHEN** a non-admin session invokes the action
- **THEN** the action returns `{ ok: false, error: 'forbidden' }` and no row changes

#### Scenario: Approval of an already-decided row is rejected

- **GIVEN** a queue row already in `approved` or `rejected`
- **WHEN** an admin invokes `approveCrpValidation(queueId)`
- **THEN** the action returns `{ ok: false, error: 'already_decided' }` and no rows change

### Requirement: Admin rejection moves the account to `suspended`

The system SHALL expose an admin Server Action `rejectCrpValidation(queueId, reason)` that, when invoked by an admin role, marks the queue row `status='rejected'`, populates `decided_at`, `decided_by`, and `rejection_reason`, and emits a `crp_rejected` event into `transitionStatus` for the corresponding `user_id`. The transition MUST move the account from `pending_crp_validation` to `suspended`.

#### Scenario: Rejection suspends the account

- **GIVEN** a queue row in `pending` for a user in `pending_crp_validation`
- **WHEN** an admin invokes `rejectCrpValidation(queueId, 'CRP não localizado no cadastro do CFP')`
- **THEN** the queue row's `status` becomes `rejected`, `rejection_reason` is stored, and the user's profile `status` becomes `suspended`

#### Scenario: Rejection requires a reason

- **WHEN** an admin invokes `rejectCrpValidation(queueId, '')` with empty reason
- **THEN** the action returns `{ ok: false, error: 'reason_required' }` and no rows change

### Requirement: No card photo is stored in production

The system MUST NOT accept or store any photographic image of the CRP card in `crp_validation_queue` or any other table. Admins requiring out-of-band documentation MUST request it via email; once a decision is taken, the image MUST NOT enter our system. This satisfies PRD 01 RN-01.05.

#### Scenario: Schema contains no image column

- **WHEN** a contributor inspects `crp_validation_queue`'s columns
- **THEN** there is no `bytea`, `image_url`, `photo`, or storage-bucket-pointer column

#### Scenario: Admin Server Action rejects file uploads

- **WHEN** an admin attempts to attach a file to `approveCrpValidation` or `rejectCrpValidation`
- **THEN** the action's Zod schema rejects the input as unknown (no file field is defined)

### Requirement: `crp-validation` module exposes its surface via a barrel

The system SHALL place CRP validation code at `src/modules/crp-validation/` with an `index.ts` barrel re-exporting the public API: `crpNumberSchema`, `crpUfSchema`, `regionalCodeToUf`, `regionalCodes`, `approveCrpValidation`, `rejectCrpValidation`. Consumers MUST import from `@/modules/crp-validation`, never from internal paths.

#### Scenario: Module exposes the documented public API

- **WHEN** any code outside `src/modules/crp-validation/` needs CRP format validation, the regional-code mapping, or the admin actions
- **THEN** it imports from `@/modules/crp-validation`
