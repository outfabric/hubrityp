## ADDED Requirements

### Requirement: Prontuario schema domain exists with RLS-enabled tables

The system SHALL maintain a dedicated schema domain `medical-records` under `src/shared/db/schema/medical-records/` containing tables for `evolutions`, `evolution_versions`, and `audit_log`. Every table MUST have RLS enabled. No table SHALL have a DELETE policy (Lei 13.787/2018 mandates 20-year retention with no destruction).

#### Scenario: RLS is enabled on all medical-records tables

- **WHEN** the migration runs
- **THEN** `evolutions`, `evolution_versions`, and `audit_log` all have `rowsecurity = true` in `pg_class`

#### Scenario: No DELETE policy exists on medical-records tables

- **WHEN** querying `pg_policies` for tables `evolutions`, `evolution_versions`, `audit_log`
- **THEN** no policy with `cmd = 'd'` exists for any of the three tables

### Requirement: Prontuario module follows the canonical module shape

The system SHALL expose the medical-records domain through `src/modules/medical-records/index.ts` (barrel). Internal structure MUST include `lib/` (Zod schemas, validators, helpers), `server/` (Server Action implementations), and `components/` (UI). External consumers MUST import only from `@/modules/medical-records`.

#### Scenario: Barrel exports all public surface

- **WHEN** another module imports from `@/modules/medical-records`
- **THEN** it can access: createEvolution, updateEvolution, getEvolutionsByPatient, getEvolutionDetail, listEvolutionVersions, logProntuarioAccess, evolution Zod schemas, template types, isWithinEditWindow, shouldForceAddendum

### Requirement: Prontuario shell page displays tabs with correct states

The system SHALL render a prontuario page at `/pacientes/[id]/prontuario` with seven tabs: Evolucoes, Hipoteses, Plano, Escalas, Documentos, Anexos, Notas. Only the "Evolucoes" tab SHALL be functional in this change. All other tabs MUST render an empty-state placeholder following the Salvia pattern (icon in `text-tertiary`, h4 "Em breve", description in `text-secondary`, no CTA).

#### Scenario: Navigate to prontuario shell

- **WHEN** psychologist navigates to `/pacientes/[id]/prontuario`
- **THEN** system displays the Tabs component with "Evolucoes" tab active by default

#### Scenario: Disabled tab shows empty state

- **WHEN** psychologist clicks the "Hipoteses" tab (or any non-Evolucoes tab)
- **THEN** system displays the "Em breve" empty state with a descriptive icon, heading, and supporting text

#### Scenario: Prontuario page requires authentication

- **WHEN** an unauthenticated user requests `/pacientes/[id]/prontuario`
- **THEN** middleware redirects to `/login?redirectTo=...`

### Requirement: Schema re-export includes medical-records domain

The system SHALL re-export all medical-records table definitions from `src/shared/db/schema/index.ts` so that the Drizzle relational API can resolve cross-domain joins.

#### Scenario: Schema barrel includes medical-records

- **WHEN** importing from `@/shared/db/schema`
- **THEN** the exports include `evolutions`, `evolutionVersions`, and `auditLog` table references
