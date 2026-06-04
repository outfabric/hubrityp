# onboarding-checklist Specification

## Purpose
The dashboard first-steps checklist (PRD 11 §5.4): an expandable Card +
Accordion that persists at the top of `/dashboard` while any mandatory item is
incomplete. It lists seven items (six mandatory + an optional AI-transcription
bonus), derives each item's completion from authoritative owner-scoped data via
an owner-scoped `recomputeChecklist` operation rather than a stale cached flag,
excludes the bonus from the 100% calculation, and shows a discreet,
reduced-motion-aware celebration when all mandatory items complete — after which
it remains reachable under Configurações > Ajuda > Primeiros passos. Created by
syncing the `onboarding-checklist-and-tour` change.

## Requirements

### Requirement: Checklist card persists on the dashboard until mandatory items complete
The system SHALL render a first-steps checklist as an expandable card at the top of `/dashboard` whenever any mandatory item is incomplete. The card MUST list seven items: cadastro completo, configurar perfil e local, cadastrar primeiro paciente, agendar primeira sessão, registrar primeira evolução, enviar primeiro termo de consentimento (mandatory), and experimentar transcrição com IA (optional/bonus). Each item MUST show its completion state and, when actionable, an action target per PRD 11 §5.4. The card MUST use design-system Card + Accordion primitives, the fixed Lucide icons, and `CheckCircle2` for completed items.

#### Scenario: Card visible while a mandatory item is pending
- **GIVEN** a psychologist with at least one mandatory checklist item incomplete
- **WHEN** they visit `/dashboard`
- **THEN** the checklist card renders at the top with the incomplete items actionable

#### Scenario: Each item shows the correct done/pending state
- **GIVEN** a psychologist who has configured a location and added a patient but scheduled no session
- **WHEN** the checklist renders
- **THEN** "configurar perfil e local" and "cadastrar primeiro paciente" show completed, and "agendar primeira sessão" shows pending with its action

### Requirement: Checklist completion is recomputed from authoritative data
The system SHALL derive each checklist item's completion from authoritative sources, not from a stale cached flag: cadastro completo = email verified + CRP validated; perfil/local = >=1 row in `locations`; primeiro paciente = >=1 patient with status `active`; primeira sessão = >=1 session with status != `cancelled`; primeira evolução = >=1 evolution saved; primeiro termo = >=1 patient with `consent_signed_at`; transcrição IA (bonus) = AI transcription enabled AND >=1 transcription started. A `recomputeChecklist` operation SHALL run with `getUser()` auth, compute these from the owner's data, and persist the booleans to the owner's `onboarding_checklist` row.

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

### Requirement: Bonus item does not block completion
The system SHALL treat "experimentar transcrição com IA" as optional: it carries a "Bônus" badge (distinct from mandatory items) and is excluded from the 100%-complete calculation (RF-11.10). Completion is reached when all six mandatory items are done, regardless of the bonus item's state.

#### Scenario: 100% reached with bonus still pending
- **GIVEN** a psychologist with all six mandatory items done and the AI bonus item pending
- **WHEN** completion is evaluated
- **THEN** the checklist is considered 100% complete and the celebration triggers

### Requirement: Completing the mandatory items triggers a discreet celebration
The system SHALL, when all six mandatory items become complete, show a discreet celebration animation (<=300ms, no bouncing, honoring `prefers-reduced-motion`) and the message "Você completou a configuração inicial. Seu consultório está no sistema!", then collapse the card. After completion the checklist SHALL remain available under Configurações > Ajuda > Primeiros passos.

#### Scenario: Celebration appears once on completion
- **WHEN** the last mandatory item flips to complete
- **THEN** the celebration + message render once and the card collapses

#### Scenario: Reduced motion is respected
- **GIVEN** a client with `prefers-reduced-motion: reduce`
- **WHEN** the celebration triggers
- **THEN** the animation is reduced to a near-instant transition per the design system

#### Scenario: Checklist remains reachable after completion
- **WHEN** a psychologist with a completed checklist opens Configurações > Ajuda > Primeiros passos
- **THEN** the checklist is shown with all items marked complete
