## MODIFIED Requirements

### Requirement: Checklist completion is recomputed from authoritative data
The system SHALL derive each checklist item's completion from authoritative sources, not from a stale cached flag: cadastro completo = email verified + CRP validated; perfil/local = >=1 row in `locations`; primeiro paciente = >=1 patient with status `active`; primeira sessão = >=1 session with status != `cancelled`; primeira evolução = >=1 evolution saved; primeiro termo = >=1 patient with `consent_signed_at`; transcrição IA (bonus) = AI transcription enabled AND >=1 transcription started. A `recomputeChecklist` operation SHALL run with `getUser()` auth, compute these from the owner's data, and persist the booleans to the owner's `onboarding_checklist` row. This recompute SHALL be the **single shared source of truth** for first-steps completion across BOTH the dashboard checklist and the onboarding wizard's step-4 summary; neither surface SHALL base completion on a potentially-stale stored flag, so data created in one surface is reflected in the other without re-entry.

#### Scenario: Recompute reflects newly created data
- **GIVEN** a psychologist whose `first_session_scheduled` flag is FALSE
- **WHEN** they create a session and the checklist is recomputed
- **THEN** `onboarding_checklist.first_session_scheduled` becomes TRUE

#### Scenario: Recompute is owner-scoped
- **WHEN** the recompute runs
- **THEN** every source query is filtered by `user_id = auth.uid()`; another psychologist's patients/sessions never satisfy the caller's checklist items

#### Scenario: Recompute ignores a client-supplied user id
- **WHEN** the recompute payload includes a `userId` for another account
- **THEN** the operation ignores it and writes only the `auth.uid()` row

#### Scenario: Wizard summary and dashboard checklist agree
- **GIVEN** a psychologist who created a location via `/configuracoes/locais` and added a patient in the wizard
- **WHEN** both the wizard step-4 summary and the dashboard checklist render
- **THEN** the "local" and "primeiro paciente" items show as complete on both surfaces, because both derive from the same authoritative recompute
