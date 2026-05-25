## ADDED Requirements

### Requirement: `/dashboard/transcricoes/[id]/revisar` renders the AI note review experience

The system SHALL provide a gated route at `/dashboard/transcricoes/[id]/revisar` (folder: `src/app/(app)/dashboard/transcricoes/[id]/revisar/page.tsx`). The page SHALL be a Server Component that calls `getTranscriptionForReview({ transcriptionId: params.id })` and renders:

1. **Header**: page `h1 = "Revisar nota IA"`, `body-sm` showing patient first name and session date/time. `<TranscriptionStatusBadge status={status} />`.
2. **Draft warning banner** (always visible if `status='ready'`): `Alert` variant warning, text `"Esta nota foi gerada por IA. Revise-a antes de salvar — você é responsável pelo conteúdo final."` (RF-10.15).
3. **Risk alert banner** (only when `risk_alerts.length > 0`): `Alert` variant danger, `role="alert"`, auto-focus, lists each alert (`kind` translated to pt-BR) with the excerpt. Subtitle: `"Considere: contato pós-sessão, plano de segurança, encaminhamento."` (RF-10.18).
4. **TranscriptionReviewForm** (Client Component): one field per `generated_note` property. Auto-save every 10s + on-blur. `"Salvo às HH:MM"` indicator (text-tertiary). Checkbox `"Revisei a nota e confirmo que reflete a sessão."` required to enable the primary action.
5. **Action row**: three buttons:
   - Primary: `"Salvar no prontuário"` (disabled until checkbox checked) — invokes `saveTranscriptionToProntuario`.
   - Secondary: `"Editar mais"` — closes auto-save, keeps user on the page.
   - Danger (or ghost): `"Descartar e escrever manualmente"` — opens `AlertDialog` confirming discard; on confirm, invokes `discardTranscription` and redirects to `/dashboard/pacientes/[patientId]/evolucoes/nova?sessionId=<sid>`.

If `status='failed'` or `status='cancelled'`, the page renders a different state (no form, no save button — just status badge and reason); a button `"Tentar de novo"` re-dispatches `ai-transcription/audio.uploaded` if `status='failed'`.

#### Scenario: Anonymous access is blocked
- **GIVEN** no session cookie
- **WHEN** the URL is opened
- **THEN** middleware redirects to `/login`
- **AND** no DB query is made

#### Scenario: Cross-tenant IDOR is blocked
- **WHEN** psychologist B opens a `transcriptionId` belonging to A
- **THEN** `getTranscriptionForReview` returns `NOT_FOUND`
- **AND** the page renders the not-found state (NOT the actual data, NOT the patient name)

#### Scenario: Risk banner appears and takes focus
- **GIVEN** a transcription with two `risk_alerts`
- **WHEN** the page mounts
- **THEN** the red banner is rendered above the form
- **AND** the banner has `role="alert"` and receives focus
- **AND** the two excerpts are visible in distinct list items

#### Scenario: Save button disabled until checkbox
- **WHEN** the form is loaded
- **THEN** the primary `"Salvar no prontuário"` button is disabled
- **AND** clicking the checkbox enables it

#### Scenario: Failed status shows retry path
- **GIVEN** the row's `status='failed'` with `error_code='gemini_429'`
- **WHEN** the page loads
- **THEN** the form is NOT rendered
- **AND** a `"Tentar de novo"` button is visible
- **AND** clicking it dispatches a new `ai-transcription/audio.uploaded` event (or invokes a retry Server Action)

### Requirement: `getTranscriptionForReview` is the canonical read-for-review query

The system SHALL expose `getTranscriptionForReview({ transcriptionId }): Promise<GetTranscriptionForReviewResult>` from `@/modules/ai-transcription`. The action SHALL:

1. Authenticate via `getUser`.
2. Zod-validate input.
3. Drizzle SELECT (RLS-scoped): join `ai_transcriptions` ↔ `patients` ↔ `sessions` (left), filter by `user_id = caller AND id = transcriptionId`.
4. If no row, return `{ ok: false, code: 'NOT_FOUND' }`.
5. Validate `generated_note` and `risk_alerts` JSONB via Zod (drift detection).
6. Return:
```ts
{
  ok: true;
  transcriptionId, status, source, templateUsed,
  patientFirstName, patientId, sessionId, sessionDate,
  generatedNote: GeneratedNote | null,
  riskAlerts: RiskAlert[],
  savedToProntuario, evolutionId,
  errorCode: string | null,
  createdAt, completedAt
}
```

#### Scenario: Returns only the caller's own row
- **WHEN** B queries A's `transcriptionId`
- **THEN** result is `{ ok: false, code: 'NOT_FOUND' }`

#### Scenario: Drift in JSONB logged but not thrown
- **GIVEN** a row whose `generated_note` lacks a required field
- **WHEN** the action runs
- **THEN** the log emits `note_schema_drift` (no payload) and the response sets `generatedNote: null`

#### Scenario: PII is in the response but NOT in logs
- **WHEN** the action runs
- **THEN** the response contains `patientFirstName`
- **AND** no log line emitted by the action contains the patient name (Pino redact paths cover it)

### Requirement: `updateTranscriptionDraft` saves edits with audit counters

The system SHALL expose `updateTranscriptionDraft({ transcriptionId, generatedNote }): Promise<UpdateDraftResult>`. The action SHALL:

1. Authenticate, validate (Zod: `generatedNote` parsed by `GeneratedNoteSchema`).
2. Ownership check.
3. UPDATE row SET `generated_note = $jsonb`, `user_edits_count = user_edits_count + 1`, `updated_at = now()` WHERE `id = $tx AND user_id = $caller AND status IN ('ready','reviewed')`.
4. If 0 rows affected, return `{ ok: false, code: 'NOT_EDITABLE' }` (status was `pending`/etc).
5. Return `{ ok: true, savedAt: new Date() }`.

#### Scenario: Edits persist
- **WHEN** the user changes a field and the auto-save fires
- **THEN** the next read returns the new value
- **AND** `user_edits_count` is incremented

#### Scenario: Concurrent abs update — last write wins
- **GIVEN** two abs each call update with different payloads
- **WHEN** both complete
- **THEN** the row reflects the later payload (no merge)

#### Scenario: Cannot edit when status='pending'
- **WHEN** the action is invoked on a `pending` row
- **THEN** returns `NOT_EDITABLE`

### Requirement: `saveTranscriptionToProntuario` creates a flagged evolution

The system SHALL expose `saveTranscriptionToProntuario({ transcriptionId, reviewedChecked }): Promise<SaveResult>`. The action SHALL:

1. Authenticate, validate (`reviewedChecked` MUST be `true` — Zod literal; otherwise `MUST_REVIEW`).
2. Ownership check.
3. Re-read the row; require `status='ready' OR status='reviewed'` AND `saved_to_prontuario=false`.
4. Call `createEvolutionImpl({ patientId, sessionId, content: serializeNoteAsEvolution(generatedNote), aiAssisted: true, aiTranscriptionId: transcriptionId })`. The serializer converts the structured note to the format expected by the evolution editor (markdown or HTML — match what existing evolutions store).
5. UPDATE the `ai_transcriptions` row: `status='reviewed'`, `saved_to_prontuario=true`, `evolution_id=<newEvolutionId>`, `reviewed_at=now()`.
6. Both UPDATEs in a single Drizzle transaction.
7. Return `{ ok: true, evolutionId }`.

#### Scenario: Happy path
- **WHEN** the action runs against a reviewed-and-confirmed row
- **THEN** a new row exists in `evolutions` with `ai_assisted=true` and `ai_transcription_id` matching
- **AND** the `ai_transcriptions` row is `reviewed` and `saved_to_prontuario=true`

#### Scenario: Idempotent — second call is rejected
- **GIVEN** an already-saved row
- **WHEN** the action is invoked again
- **THEN** returns `{ ok: false, code: 'ALREADY_SAVED' }`
- **AND** no second `evolutions` row is created

#### Scenario: `reviewedChecked=false` rejected
- **WHEN** the action is called with `reviewedChecked: false`
- **THEN** Zod parsing fails with `MUST_REVIEW`
- **AND** no DB writes

#### Scenario: Cross-tenant IDOR rejected
- **WHEN** B calls the action with A's `transcriptionId`
- **THEN** returns `NOT_FOUND`
- **AND** no evolution is created

### Requirement: `discardTranscription` marks reviewed without saving

The system SHALL expose `discardTranscription({ transcriptionId }): Promise<DiscardResult>`. UPDATE `status='reviewed'`, `saved_to_prontuario=false`, `reviewed_at=now()` on the caller's row. Audit-log via the existing audit helper (event name `ai_transcription_discarded`, payload: IDs only).

#### Scenario: Idempotent
- **WHEN** called twice
- **THEN** second call returns `{ ok: false, code: 'ALREADY_REVIEWED' }`

#### Scenario: Audit logged
- **WHEN** the action runs
- **THEN** the audit table has a row with `event = 'ai_transcription_discarded'`, `user_id`, `transcription_id`, NO PII

### Requirement: `/dashboard/transcricoes` lists transcriptions awaiting review

The system SHALL provide `/dashboard/transcricoes/page.tsx` (Server Component) rendering a list of the authenticated user's transcriptions, ordered by priority: pending review (`status='ready' AND saved_to_prontuario=false`) first, then `reviewed`, then `failed`. Tabs: `"Pendentes"`, `"Revisadas"`, `"Falhas"`. Each card shows: patient first name, session date, `template_used`, status badge, `"Ver"` link.

#### Scenario: Empty state
- **GIVEN** no transcriptions for the user
- **WHEN** the page loads
- **THEN** an empty state renders with `Sparkles` icon, headline `"Nenhuma transcrição ainda"`, body `"Quando você enviar um áudio de sessão, as notas geradas aparecerão aqui."`, primary CTA `"Ver pacientes"` (link to `/dashboard/pacientes`).

#### Scenario: Tab filtering
- **WHEN** the `"Revisadas"` tab is clicked
- **THEN** only `status='reviewed'` rows appear

#### Scenario: Anonymous redirect
- **WHEN** anonymous
- **THEN** middleware redirects to `/login`

### Requirement: Realtime subscriber refreshes UI on `ready`

The system SHALL provide `useAiTranscriptionRealtime()` at `src/modules/ai-transcription/hooks/use-ai-transcription-realtime.ts`. The hook subscribes to `ai-transcription:user:<userId>` (userId from session). On `event: 'ready'`:

- Invalidates the TanStack Query keys `['ai-transcriptions','list']` and `['ai-transcriptions','ready-count']`.
- Fires a Sonner toast (variant default) with title `"Nova nota IA pronta para revisão"`, action button `"Ver"` linking to `/dashboard/transcricoes/<transcriptionId>/revisar`.

The hook SHALL be mounted in `src/app/(app)/layout.tsx` (or via a small wrapper Client Component) so that any authenticated page receives notifications. The hook SHALL unsubscribe on unmount.

#### Scenario: Toast appears on broadcast
- **GIVEN** the user is on `/dashboard/pacientes`
- **WHEN** `processAudioTranscription` finishes and broadcasts `ready`
- **THEN** a toast appears within 1 second
- **AND** clicking `"Ver"` navigates to the review page

#### Scenario: B's events do not reach A
- **WHEN** B's job finishes
- **THEN** A's UI does NOT show the toast (channel restricted by `userId`)

### Requirement: Agenda session card shows the AI badge when a ready transcription exists

The system SHALL update `src/modules/agenda/components/session-card.tsx` to render a `Badge` (variant `brand`, with `Sparkles` icon, label `"Nota IA"`) when at least one `ai_transcriptions` row matching `session_id` exists with `status='ready' AND saved_to_prontuario=false`. The badge is clickable and navigates to `/dashboard/transcricoes/<transcriptionId>/revisar`.

#### Scenario: Badge appears for ready transcription
- **GIVEN** a session with a `ready` transcription
- **WHEN** the agenda renders that session card
- **THEN** the AI badge is visible

#### Scenario: No badge when reviewed
- **GIVEN** a session whose only transcription is `reviewed`
- **WHEN** the card renders
- **THEN** the badge is NOT shown

#### Scenario: Badge accessibility
- **WHEN** the badge is keyboard-focused
- **THEN** the focus ring is visible (Sálvia `shadow-focus`)
- **AND** `aria-label` reads `"Nota IA pronta para revisão"`

## MODIFIED Requirements

### Requirement: Psychologist can create an evolution linked to a session

The system SHALL allow a psychologist to create an evolution linked to a session via `createEvolutionImpl({ patientId, sessionId, content, ... })`. The function SHALL accept two new optional parameters: `aiAssisted?: boolean` (default `false`) and `aiTranscriptionId?: string | null` (default `null`). When `aiAssisted=true`, the inserted row SHALL have `ai_assisted=true` and `ai_transcription_id=<provided>`. The function SHALL continue to enforce all existing rules (ownership, RLS, validation, version creation, etc.) without change.

The `evolutions` table SHALL be extended with two columns: `ai_assisted boolean NOT NULL DEFAULT false`, `ai_transcription_id uuid NULL REFERENCES ai_transcriptions(id) ON DELETE SET NULL`. RLS policies on `evolutions` are NOT modified — the predicate `user_id = auth.uid()` already covers ownership for both columns. A new index `idx_evolutions_user_ai_assisted` on `(user_id, ai_assisted)` SHALL be created to serve audit/statistics queries.

#### Scenario: Default behavior unchanged for existing callers
- **WHEN** an existing caller invokes `createEvolutionImpl` without the new options
- **THEN** the row has `ai_assisted=false` and `ai_transcription_id=NULL`
- **AND** all existing test assertions remain valid

#### Scenario: AI-assisted evolution is auditable
- **WHEN** `createEvolutionImpl` is called with `aiAssisted=true, aiTranscriptionId='<tx>'`
- **THEN** the inserted row's flag and FK match
- **AND** querying `WHERE user_id = X AND ai_assisted = true` yields the row efficiently (index used)

#### Scenario: Deleting the source transcription does not delete the evolution
- **GIVEN** an evolution linked to a transcription
- **WHEN** the transcription row is deleted (edge case — manual admin op)
- **THEN** the evolution's `ai_transcription_id` becomes NULL
- **AND** the evolution itself remains

### Requirement: `classifyPath()` covers `/dashboard/transcricoes` and its subpaths

The system SHALL extend `src/middleware.ts:classifyPath()` so that any URL matching `^/dashboard/transcricoes(/|$)` is classified as `'app'` (gated). The existing rules for other `/dashboard/*` paths remain unchanged. The `decideWithProfile` function continues to enforce the per-user-status policy.

#### Scenario: Anonymous request to `/dashboard/transcricoes` redirects to `/login`
- **WHEN** an anonymous client requests `/dashboard/transcricoes`
- **THEN** middleware returns a redirect to `/login` with `?from=/dashboard/transcricoes`

#### Scenario: Anonymous request to `/dashboard/transcricoes/<id>/revisar` redirects to `/login`
- **WHEN** an anonymous client requests the review subpath
- **THEN** middleware returns a redirect to `/login`

#### Scenario: Authenticated active user reaches the route
- **WHEN** an `Active` profile requests `/dashboard/transcricoes`
- **THEN** middleware passes through and the page renders
