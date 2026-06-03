# dashboard-home Specification

## Purpose
The authenticated psychologist's operational home at `/dashboard`: four owner-scoped sections (Hoje, Pendências, Resumo da semana, Ações rápidas) built on Sálvia design-system primitives, with modality-aware session routing, MVP-only pendências, owner-only weekly metrics streamed behind `<Suspense>`, MVP quick-action shortcuts that reuse existing creation modals, mobile-first responsive collapse, a zero-data first-steps slot, and an idempotent `first_access_at` stamp on first render. Created by syncing the `dashboard-home` change.

## Requirements

### Requirement: Dashboard renders the four operational sections
The system SHALL render `/dashboard` with four sections in priority order: (1) Hoje, (2) Pendências, (3) Resumo da semana, (4) Ações rápidas. The page MUST use Sálvia design-system Card primitives (radius `xl`, neutral surface, no nested cards, brand color only on primary actions) and the fixed Lucide icon map (Calendar for sessions, Users for patients, FileText for prontuário, Sparkles for AI). All data MUST be scoped to the authenticated psychologist.

#### Scenario: Authenticated psychologist sees the four sections
- **GIVEN** an authenticated psychologist with `status = active`
- **WHEN** they visit `/dashboard`
- **THEN** the Hoje, Pendências, Resumo da semana, and Ações rápidas sections render in that DOM order

#### Scenario: Anonymous request is redirected
- **WHEN** an anonymous client visits `/dashboard`
- **THEN** the middleware redirects to `/login?redirectTo=%2Fdashboard`

### Requirement: Seção Hoje shows the next and remaining sessions of the day
The system SHALL show, in Seção Hoje, the next upcoming session today (patient name, time in `America/Sao_Paulo`, modality) with a primary "Abrir sessão" button — routing to the video room when modality is `online` and to the patient file when `in_person` — plus a compact list of the day's other sessions with time, name, and status (agendada/confirmada/realizada/cancelada/no-show). When there are no sessions today, it MUST show "Nenhuma sessão hoje. Que tal [agendar uma]?" linking to the agenda. Session and patient data MUST come only from the owner's rows.

#### Scenario: Next session routes by modality
- **GIVEN** the psychologist's next session today has modality `online`
- **WHEN** they click "Abrir sessão"
- **THEN** they are routed to the session's video room; if modality were `in_person`, they would be routed to the patient file instead

#### Scenario: No sessions today shows the schedule CTA
- **GIVEN** the psychologist has zero sessions dated today
- **WHEN** the Hoje section renders
- **THEN** it shows "Nenhuma sessão hoje" with an "agendar uma" link to the agenda

#### Scenario: Day list is owner-scoped
- **WHEN** the Hoje query runs
- **THEN** it returns only sessions where `user_id = auth.uid()` and never another psychologist's sessions

### Requirement: Seção Pendências shows only MVP pendências
The system SHALL show, in Seção Pendências, exactly these MVP pendência types: (a) evoluções em atraso — count of `done` sessions older than 7 days with no evolution recorded, linking to a filtered agenda view; (b) patients without `consent_signed_at`, linking to a filtered `/pacientes` view; (c) AI transcription notes awaiting review (count), linking to the review screen. When there are no pendências, it MUST show a discreet "Tudo em dia." The section MUST NOT display any post-MVP pendência (Receita Saúde, cobranças, WhatsApp).

#### Scenario: Overdue evolutions are counted and linked
- **GIVEN** the psychologist has 2 `done` sessions older than 7 days with no evolution
- **WHEN** the Pendências section renders
- **THEN** it shows "2 sessões sem evolução" with a "Ver" link to the filtered agenda

#### Scenario: No pendências shows the positive state
- **GIVEN** the psychologist has zero overdue evolutions, zero patients missing consent, and zero AI notes pending
- **WHEN** the Pendências section renders
- **THEN** it shows "Tudo em dia." and occupies minimal space

#### Scenario: Post-MVP pendências never appear
- **WHEN** the Pendências section renders for any psychologist
- **THEN** the rendered text contains none of: "Receita Saúde", "cobrança", "WhatsApp"

### Requirement: Seção Resumo da semana computes owner-only metrics
The system SHALL compute, in Seção Resumo da semana, metrics over ONLY the logged-in psychologist's data: sessions done this week, sessions scheduled this week (including today), no-show rate (only when there is enough data), new patients this month, and evolutions this week. No aggregate that could be mistaken for a market benchmark SHALL be shown (RN-11.04). Each metric MUST have a graceful empty state ("Ainda sem dados suficientes — agende sua primeira sessão para começar."). This section MAY be streamed in a `<Suspense>` boundary so the day's data paints first.

#### Scenario: Metrics are owner-scoped
- **WHEN** the weekly summary queries run
- **THEN** every count is filtered by `user_id = auth.uid()`; a second psychologist's sessions never contribute

#### Scenario: No-show rate hidden without enough data
- **GIVEN** the psychologist has fewer sessions than the minimum threshold for a meaningful rate
- **WHEN** the summary renders
- **THEN** the no-show rate shows its empty state instead of a misleading percentage

#### Scenario: Weekly summary does not block first paint
- **WHEN** the dashboard loads
- **THEN** Seção Hoje renders before the weekly summary resolves (summary is inside a `<Suspense>` fallback)

### Requirement: Seção Ações rápidas offers MVP shortcuts
The system SHALL show, in Seção Ações rápidas: "+ Novo paciente" (opens the existing quick-create patient modal), "+ Nova sessão" (opens the existing quick-schedule session modal), "Ver agenda completa" (→ `/agenda`), and "Ver pacientes" (→ `/pacientes`). It MUST reuse the existing patient/session creation modals, not reimplement them.

#### Scenario: Quick actions open existing modals
- **WHEN** the psychologist clicks "+ Novo paciente"
- **THEN** the existing patient quick-create modal opens (the same one used in `/pacientes`)

### Requirement: Dashboard is responsive and degrades gracefully on mobile
The system SHALL, on mobile widths, prioritize Seção Hoje and Seção Pendências and collapse Seção Resumo and Seção Ações behind a chevron-expand control (RF-11.07). Layout MUST be mobile-first per the design system and meet a 44×44px minimum touch target for interactive elements.

#### Scenario: Mobile collapses the lower sections
- **WHEN** the dashboard renders at a 375px viewport
- **THEN** Hoje and Pendências are visible and Resumo + Ações are collapsed behind a chevron control that expands them

### Requirement: Empty dashboard surfaces the first-steps slot
The system SHALL detect when the psychologist has zero patients AND zero sessions and, in that case, render the first-steps checklist slot in place of the four normal sections (RF-11.08). Once the psychologist has any data, the normal sections render. This change exposes the empty-state slot and the "has any data" detection; the checklist component is provided by the checklist/tour change.

#### Scenario: Zero-data dashboard shows the checklist slot
- **GIVEN** a psychologist with zero patients and zero sessions
- **WHEN** they visit `/dashboard`
- **THEN** the first-steps checklist slot is rendered in place of the four normal sections

#### Scenario: Any data restores the normal sections
- **GIVEN** a psychologist with at least one patient or one session
- **WHEN** they visit `/dashboard`
- **THEN** the four normal sections render and the empty-state slot is not shown

### Requirement: First authenticated dashboard render stamps first_access_at
The system SHALL set `profiles.first_access_at = now()` on the first time an authenticated psychologist renders `/dashboard` when `first_access_at IS NULL`, using a session-scoped, idempotent write. This value seeds the day-7 NPS trigger owned by a later change. The write MUST authorize from the session (`auth.uid()`) and never from input.

#### Scenario: First access is stamped once
- **GIVEN** a psychologist with `first_access_at IS NULL`
- **WHEN** they render `/dashboard` for the first time
- **THEN** `first_access_at` is set to now(); a subsequent render does not overwrite it
