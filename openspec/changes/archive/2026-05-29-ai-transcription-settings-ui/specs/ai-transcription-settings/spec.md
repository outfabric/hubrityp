## ADDED Requirements

### Requirement: `/configuracoes/transcricao-ia` is the settings page for AI transcription

The system SHALL provide a Server Component page at `src/app/(app)/configuracoes/transcricao-ia/page.tsx`. The page SHALL:

1. Resolve the authenticated user via `getUser`.
2. Call `getTranscriptionSettings(userId)` — upserts default row if missing, returns current settings.
3. Call `getTranscriptionStats(userId)` for the stats panel.
4. Render `<TranscriptionSettingsForm initial={settings} />` + `<TranscriptionStatsPanel stats={stats} />` + breadcrumb via the existing settings layout helper.

The page SHALL inherit the existing `/configuracoes/*` layout (sidebar, breadcrumb, padding).

#### Scenario: First visit creates the default settings row
- **GIVEN** no row in `ai_transcription_settings` for the user
- **WHEN** the page loads
- **THEN** an UPSERT inserts a row with defaults (`enabled=false`, `defaultTemplate='livre'`, `keepAudioHours=24`, `keepTranscription=false`, `riskDetectionSensitivity='medium'`)
- **AND** the form renders those defaults

#### Scenario: Anonymous request redirected
- **WHEN** anonymous
- **THEN** middleware redirects (existing `/configuracoes*` gating)

### Requirement: `<TranscriptionSettingsForm>` exposes all configurable knobs

The Client Component `transcription-settings-form.tsx` SHALL render the following controls, all from shadcn/ui + Sálvia tokens:

| Control | Label (pt-BR) | Helper text | Field |
|---|---|---|---|
| `Switch` | "Ativar Transcrição IA" | "Quando ligada, novas sessões com termo de gravação assinado serão processadas automaticamente." | `enabled` |
| `Select` | "Template padrão da nota" | "Aplica-se apenas a novas transcrições." Opções: TCC, Psicanálise, Sistêmica, ABA, Livre. | `defaultTemplate` |
| `RadioGroup` (3 opções, vertical) | "Sensibilidade de detecção de risco" | (helper de cada opção conforme design — Baixa/Média/Alta) | `riskDetectionSensitivity` |
| `Select` (1 opção visível no MVP: 24h) | "Reter áudio por" | "Configurações acima de 24h exigem registro adicional e ajuste do termo de consentimento. No momento, apenas 24h está disponível." | `keepAudioHours` |
| `Switch` | "Manter transcrição textual" | "Por padrão, apenas a nota estruturada é mantida. Mantenha a transcrição apenas com razão clínica documentada." | `keepTranscription` |

The form uses React Hook Form + Zod resolver (input schema in `lib/settings-schemas.ts`). Save via a `Button` primary "Salvar configurações". On click → `updateTranscriptionSettings(values)` → Sonner toast.

Disabling the feature when it was enabled SHALL open an `AlertDialog` confirming the change before submitting, with copy: `"Desativar a Transcrição IA? Novas sessões não serão processadas. Transcrições em andamento concluirão normalmente."`

#### Scenario: All defaults render correctly
- **GIVEN** a freshly-created settings row
- **WHEN** the form mounts
- **THEN** Switch off; default template `Livre`; risk `Média`; retenção `24h`; manter transcrição off

#### Scenario: Disabling shows confirmation
- **GIVEN** the form has `enabled=true`
- **WHEN** the user toggles the switch off and clicks Salvar
- **THEN** an AlertDialog opens
- **AND** the action runs only on confirm

#### Scenario: Save flow shows toast and updates
- **WHEN** the user changes the template and saves
- **THEN** `updateTranscriptionSettings` is invoked
- **AND** a success Sonner toast appears
- **AND** the form's initial values match the new state on next visit

#### Scenario: Risk RadioGroup explains each option
- **WHEN** the radio group renders
- **THEN** each of the three radio items has a `body-sm` helper explanation (Baixa / Média / Alta)

#### Scenario: Microcopy follows the glossary
- **WHEN** the form renders
- **THEN** "Sessão", "Paciente", "Termo", "Transcrição IA" are used (never "Consulta", "Cliente arquivo", etc.)

#### Scenario: WCAG passes
- **WHEN** the form is rendered in light and dark mode
- **THEN** axe-core reports zero issues
- **AND** tab order traverses controls in document order
- **AND** every control has an associated `<label>` via `htmlFor`/`id`

### Requirement: `updateTranscriptionSettings` Server Action persists settings with audit

The system SHALL expose `updateTranscriptionSettings(input): Promise<UpdateSettingsResult>` from `@/modules/ai-transcription`. The action SHALL:

1. getUser → safeParse.
2. UPSERT row in `ai_transcription_settings` for the user.
3. Compute and log audit events when values change:
   - `enabled` false→true: `ai_transcription_enabled`
   - `enabled` true→false: `ai_transcription_disabled`
   - `keepAudioHours` increased: `ai_transcription_retention_changed`
   - `keepTranscription` toggled: `ai_transcription_keep_transcription_toggled`
   - Each audit row payload `{ userId, oldValue, newValue }` — NO PII.
4. Return `{ ok: true }`.

#### Scenario: First save creates the audit when enabling
- **GIVEN** a fresh settings row with `enabled=false`
- **WHEN** the action runs with `enabled=true`
- **THEN** the row is updated
- **AND** an audit row with `event='ai_transcription_enabled'` exists

#### Scenario: Toggling without change emits no audit
- **GIVEN** `enabled=true`
- **WHEN** the action runs with `enabled=true` (idempotent save)
- **THEN** no new audit row is created

#### Scenario: Anonymous rejected
- **GIVEN** no session
- **THEN** UNAUTHORIZED, no DB writes

#### Scenario: IDOR is impossible
- **WHEN** the action runs
- **THEN** the UPSERT uses `user_id = session.id` — no input field controls the row identity

### Requirement: `getTranscriptionStats` returns aggregated metrics

The system SHALL expose `getTranscriptionStats(): Promise<TranscriptionStatsView>` returning:

```ts
{
  totalProcessed: number;
  monthProcessed: number;
  reviewed: number;
  savedToProntuario: number;
  estimatedMinutesSaved: number;       // monthProcessed * 8 (RF-10.23)
  acceptanceRatePercent: number | null; // null when reviewed < 5; else 100 * saved_without_edits / reviewed
  avgCostUsd: number | null;            // null when cost rows absent; else avg(transcription_cost_usd + llm_cost_usd) over completed
  failedCount: number;
}
```

All queries SHALL be RLS-scoped.

#### Scenario: Empty user
- **GIVEN** no transcriptions
- **WHEN** the action runs
- **THEN** all counts are 0; `estimatedMinutesSaved=0`; `acceptanceRatePercent=null`; `avgCostUsd=null`

#### Scenario: Acceptance rate computed when enough samples
- **GIVEN** 10 reviewed rows, 7 saved with `user_edits_count=0`
- **THEN** `acceptanceRatePercent = 70`

#### Scenario: Acceptance rate withheld for small samples
- **GIVEN** 3 reviewed rows
- **THEN** `acceptanceRatePercent = null`

#### Scenario: Costs computed when usageMetadata present
- **GIVEN** 5 rows with both cost columns filled
- **THEN** `avgCostUsd` ≈ mean of `(transcription_cost_usd + llm_cost_usd)`

### Requirement: `<TranscriptionStatsPanel>` renders the metrics

The Server Component `transcription-stats-panel.tsx` SHALL render a responsive grid of Cards:

- **Sessões processadas (mês)** — number.
- **Total processado** — number.
- **Tempo economizado (estimado)** — `<minutes>` minutos / `<hours>h <m>min`.
- **Taxa de aceitação** — `<percent>%` OR `"Dados insuficientes"` quando `null`.

When `totalProcessed === 0`, the panel SHALL render a single empty-state card ("Nenhuma transcrição processada ainda") with the 3-part Sálvia empty state and a CTA linking to a runbook section or to the patients page.

#### Scenario: Empty state replaces all cards
- **GIVEN** `totalProcessed=0`
- **THEN** the panel renders ONE empty-state card, not four

#### Scenario: Acceptance rate shows "Dados insuficientes"
- **GIVEN** `acceptanceRatePercent=null`
- **THEN** the card displays `"Dados insuficientes"` instead of a percentage

#### Scenario: Sálvia compliance
- **WHEN** the panel renders
- **THEN** card padding is `space-6` (desktop) / `space-4` (mobile)
- **AND** no card is nested inside another
- **AND** numbers use `h2` weight 600
- **AND** labels use `caption-upper`

## MODIFIED Requirements

### Requirement: Settings index page displays interactive cards for each settings area

The settings index at `/configuracoes/page.tsx` SHALL render a grid of interactive cards for each settings area, including a new card for `"Transcrição IA"`. The new entry SHALL appear in `src/app/(app)/configuracoes/settings-areas.ts` with:

- `id: 'transcricao-ia'`
- `label: 'Transcrição IA'`
- `description: 'Ativar a feature, escolher template padrão, sensibilidade de risco e ver estatísticas.'`
- `icon: Sparkles`
- `href: '/configuracoes/transcricao-ia'`

The breadcrumb label registry (`breadcrumb-labels.ts`) SHALL add `transcricao-ia: 'Transcrição IA'`.

The cards SHALL follow the existing Sálvia patterns (interactive Card, hover state, click navigates).

#### Scenario: New card is visible
- **WHEN** the settings index renders
- **THEN** a card with label `"Transcrição IA"` and `Sparkles` icon is visible

#### Scenario: Breadcrumb shows correct label
- **WHEN** the user is on `/configuracoes/transcricao-ia`
- **THEN** the breadcrumb displays `Configurações / Transcrição IA`

#### Scenario: Existing settings cards unchanged
- **WHEN** the index renders
- **THEN** existing entries (Agenda, Integrações, Lembretes, Locais) appear unchanged
