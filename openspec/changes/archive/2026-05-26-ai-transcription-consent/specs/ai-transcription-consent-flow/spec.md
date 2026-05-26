## ADDED Requirements

### Requirement: `assertAiConsentActive` is the single authority for "AI recording is allowed"

The system SHALL expose `assertAiConsentActive(input: { userId: UserId; patientId: PatientId }): Promise<AssertAiConsentResult>` from `@/modules/ai-transcription` (file: `src/modules/ai-transcription/lib/consent.ts`). The result type is a discriminated union:

```ts
type AssertAiConsentResult =
  | { ok: true; termId: string; signedAt: Date; templateVersion: number }
  | { ok: false; reason: 'never_signed' | 'pending_signature' | 'revoked' | 'expired' | 'patient_not_found' };
```

The helper SHALL execute exactly one Drizzle query against `consent_terms` filtered by `user_id = userId AND patient_id = patientId AND kind = 'ai_recording' AND revoked_at IS NULL`, ordered by `created_at DESC LIMIT 1`. If no row, `ok: false / never_signed`. If row exists but `signed_at IS NULL`, `pending_signature`. If `signed_at IS NOT NULL` and `revoked_at IS NULL` and (the term has no expiry OR `expires_at > now()`), `ok: true`.

Every Server Action and Inngest function in `src/modules/ai-transcription/server/**` and `src/modules/ai-transcription/inngest/**` that initiates audio capture, upload, transcription, or note generation SHALL call `assertAiConsentActive` BEFORE any I/O that touches audio data, and SHALL abort with a non-PII error code if the result is `ok: false`.

#### Scenario: No term ever generated
- **GIVEN** a patient with zero rows in `consent_terms` for `kind = 'ai_recording'`
- **WHEN** `assertAiConsentActive` runs
- **THEN** returns `{ ok: false, reason: 'never_signed' }`

#### Scenario: Term generated but not yet signed
- **GIVEN** a term with `signed_at IS NULL` and `revoked_at IS NULL`
- **WHEN** `assertAiConsentActive` runs
- **THEN** returns `{ ok: false, reason: 'pending_signature' }`

#### Scenario: Term signed, not revoked
- **WHEN** `assertAiConsentActive` runs
- **THEN** returns `{ ok: true, termId, signedAt, templateVersion }`

#### Scenario: Term signed then revoked
- **GIVEN** a term with `signed_at IS NOT NULL` and `revoked_at IS NOT NULL`
- **WHEN** `assertAiConsentActive` runs
- **THEN** returns `{ ok: false, reason: 'revoked' }`

#### Scenario: Helper does not log PII
- **WHEN** the helper executes
- **THEN** no log line contains the patient's name, the term's plain text, or the token
- **AND** only IDs and timestamps may be logged

### Requirement: `generateAiConsentTerm` Server Action creates an unsigned AI term and returns a public token

The system SHALL expose `generateAiConsentTerm({ patientId }): Promise<{ ok: true; publicUrl: string; expiresAt: Date } | { ok: false; code: 'NOT_FOUND' | 'ALREADY_ACTIVE' | 'UNAUTHORIZED' }>` from `@/modules/patients` (file: `src/modules/patients/server/generate-ai-consent.ts`). The action SHALL:

1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()`).
2. Confirm the patient belongs to the authenticated user (`WHERE id = patientId AND user_id = session.id`) — RLS-scoped client.
3. If an `ai_recording` term already exists with `revoked_at IS NULL AND signed_at IS NULL`, return `{ ok: false, code: 'ALREADY_ACTIVE' }` (don't generate a duplicate).
4. If an `ai_recording` term already exists with `signed_at IS NOT NULL AND revoked_at IS NULL`, return `{ ok: false, code: 'ALREADY_ACTIVE' }`.
5. Otherwise insert a new row with `kind = 'ai_recording'`, `token = crypto.randomBytes(32).toString('base64url')`, `token_expires_at = now() + 7 days`, `template_version = 1`, `template_snapshot = jsonb(AI_CONSENT_TEMPLATE_V1)`, `revocation_takes_effect_immediately = true`.
6. Return the public URL: `${siteUrl}/termo/${token}`.

#### Scenario: Patient belongs to caller
- **WHEN** the authenticated psychologist calls `generateAiConsentTerm` on their own patient
- **THEN** a row is inserted with `kind = 'ai_recording'`, `signed_at IS NULL`, `token` is set
- **AND** the returned `publicUrl` includes the token

#### Scenario: Patient belongs to another psychologist (IDOR)
- **WHEN** psychologist B authenticates and calls `generateAiConsentTerm` with `patientId` belonging to A
- **THEN** the action returns `{ ok: false, code: 'NOT_FOUND' }` (NOT `'UNAUTHORIZED'`; we do not leak existence)
- **AND** no row is inserted in `consent_terms`

#### Scenario: Term already pending
- **WHEN** the action is called for a patient who already has a pending unsigned AI term
- **THEN** returns `{ ok: false, code: 'ALREADY_ACTIVE' }`
- **AND** does NOT create a second row

#### Scenario: Anonymous request
- **GIVEN** no session cookie
- **WHEN** the action is invoked
- **THEN** returns an `UNAUTHORIZED` error
- **AND** no row is inserted

### Requirement: `revokeAiConsentTerm` revokes an active term and emits an Inngest event

The system SHALL expose `revokeAiConsentTerm({ patientId, reason }): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'NOT_REVOCABLE' | 'UNAUTHORIZED' }>`. The action SHALL:

1. Authenticate; confirm ownership.
2. Find the active `ai_recording` term (`signed_at IS NOT NULL AND revoked_at IS NULL`) for this patient.
3. If none, return `{ ok: false, code: 'NOT_FOUND' }`.
4. Set `revoked_at = now()`, `revocation_reason = reason` (max 500 chars, Zod-validated, no PII enforcement at field level but the UI MUST warn).
5. Fire-and-forget Inngest event `ai-transcription/consent.revoked` with Zod-validated payload `{ termId, userId, patientId, revokedAt, reason }`.
6. Return `{ ok: true }`.

#### Scenario: Revocation succeeds
- **WHEN** the active term is revoked
- **THEN** `revoked_at` is set and the event is dispatched
- **AND** subsequent calls to `assertAiConsentActive` return `revoked`

#### Scenario: Revoking a non-existent or already-revoked term
- **WHEN** there is no active term for the patient
- **THEN** returns `{ ok: false, code: 'NOT_FOUND' }`

#### Scenario: Event dispatch failure does not break the user operation
- **GIVEN** `inngest.send` throws
- **WHEN** the user revokes
- **THEN** the DB update completes
- **AND** the error is logged with `event: 'inngest_send_failed'` (no PII)
- **AND** the user receives `{ ok: true }`

### Requirement: `getAiConsentStatus` returns UI-ready state

The system SHALL expose `getAiConsentStatus({ patientId }): Promise<AiConsentStatusView>` where `AiConsentStatusView` is a discriminated union:

```ts
type AiConsentStatusView =
  | { state: 'none' }
  | { state: 'pending'; publicUrl: string; expiresAt: Date; createdAt: Date }
  | { state: 'active'; signedAt: Date; templateVersion: number }
  | { state: 'revoked'; revokedAt: Date; reason: string | null };
```

The action SHALL authenticate, scope by ownership, and return the most recent `ai_recording` term's view. RLS-scoped Drizzle client only.

#### Scenario: All four states are observable
- **GIVEN** four patients of the same psychologist, each in one of the four states
- **WHEN** the action runs for each
- **THEN** the returned `state` matches reality

#### Scenario: Patient of another psychologist
- **WHEN** psychologist B calls the action on patient of A
- **THEN** returns `{ state: 'none' }` (RLS naturally filters; no leak)

### Requirement: Public `/termo/[token]` route renders the AI consent template when `kind = 'ai_recording'`

The system SHALL extend `src/app/termo/[token]/page.tsx` to dispatch by the row's `kind`:

- If `kind = 'general'`: existing template (unchanged behavior).
- If `kind = 'ai_recording'`: render the snapshot in `template_snapshot` (which equals `AI_CONSENT_TEMPLATE_V1` for terms generated by this change) WITH a "Eu li e concordo" checkbox + signature input + submit button.

The route SHALL remain public (token-gated). The route SHALL set `Referrer-Policy: no-referrer` on the response (per-route header in `next.config.ts` or via `headers()` in the page). On submit, the route SHALL:

1. Verify the token via Drizzle SELECT (no string concat — parameterized).
2. Reject if `token_expires_at < now()` (returns "Link expirado" message).
3. Reject if `signed_at IS NOT NULL` (already signed).
4. UPDATE the row: `signed_at = now()`, `signed_ip = sha256(remoteIp + serverSalt)`, `signed_user_agent = sha256(uaHeader + serverSalt)`.

#### Scenario: Expired token shows expired message
- **GIVEN** a term with `token_expires_at = now() - 1 day`
- **WHEN** the public link is opened
- **THEN** the page renders an "expired" state and does NOT show the consent text

#### Scenario: Already signed shows confirmation
- **GIVEN** a term with `signed_at IS NOT NULL`
- **WHEN** the public link is opened
- **THEN** the page renders "Termo já assinado em DD/MM/YYYY"

#### Scenario: Signature persists hashed metadata
- **WHEN** the patient submits the signature
- **THEN** the row's `signed_ip` and `signed_user_agent` are hex strings of length 64 (SHA-256), NOT the raw values
- **AND** `signed_at` is set within 5 seconds of submission

#### Scenario: Referer header does not leak the token
- **WHEN** the patient navigates from `/termo/<token>` to an external link
- **THEN** the outgoing request's Referer is empty (Referrer-Policy applied)

### Requirement: Canonical AI consent template is versioned and snapshot at issue time

The system SHALL define `AI_CONSENT_TEMPLATE_V1` in `src/modules/ai-transcription/lib/consent-template.ts` containing at minimum the following sections, in pt-BR:

1. **Identificação** — psicólogo (nome, CRP) e paciente (nome).
2. **Finalidade** — gravação da sessão e processamento por IA para gerar evolução clínica destinada ao prontuário (PRD 05).
3. **Bases legais (LGPD)** — art. 7º, II (execução de contrato), art. 11 (dado sensível de saúde), art. 6º (princípios).
4. **Operação de tratamento** — controlador (o psicólogo), operador (Google Gemini API), categorias de dados (áudio, transcrição, nota), transferência (servidores do Google sob contrato de operador).
5. **Retenção** — áudio descartado em 24h por padrão; transcrição não retida; nota estruturada incorporada ao prontuário sob guarda do psicólogo por 20 anos (Lei 13.787/2018).
6. **Direitos do titular** — acesso, correção, eliminação, revogação a qualquer momento (LGPD art. 18).
7. **Revogação** — efeito imediato sobre gravações futuras; gravações passadas processadas mantêm-se em conformidade com a obrigação legal de guarda de prontuário.
8. **Riscos** — alucinação da IA (a nota é rascunho, supervisionada pelo psicólogo); falhas técnicas que possam estender o tempo de descarte do áudio.

The template MUST be snapshot into `template_snapshot jsonb` at the moment of term generation; later edits to the template do NOT affect terms already signed.

#### Scenario: Template snapshot is preserved
- **GIVEN** a term signed under `template_version = 1`
- **WHEN** a future change introduces `AI_CONSENT_TEMPLATE_V2`
- **THEN** the existing term's `template_snapshot` continues to render V1 text
- **AND** `template_version = 1` is preserved

### Requirement: `AiConsentPanel` component on the patient detail page

The system SHALL add `AiConsentPanel` at `src/modules/patients/components/ai-consent-panel.tsx`, embedded in the patient detail page at `src/app/(app)/pacientes/[id]/page.tsx`. The component SHALL render one of four UI states matching `getAiConsentStatus` output and follow the Sálvia Design System:

- `none` → `Card` (default), `h3 = "Transcrição IA"`, `body` explaining purpose, `Button` (primary) `"Gerar termo de consentimento"`. Icon `Sparkles` next to the heading.
- `pending` → same card with `body-sm` showing "Aguardando assinatura — expira em DD/MM/YYYY", a read-only `Input` with the public URL, and `Button` (secondary) `"Copiar link"` + `Button` (ghost) `"Reenviar"`.
- `active` → `Card`, `Badge` (success) `"Vigente"`, `body-sm` "Assinado em DD/MM/YYYY", `Button` (danger) `"Revogar termo"` opens an `AlertDialog` with destructive confirmation requiring typing `"REVOGAR"`.
- `revoked` → `Card`, `Badge` (warning) `"Revogado em DD/MM/YYYY"`, `Button` (primary) `"Gerar novo termo"`.

The component SHALL use `TanStack Query` for `getAiConsentStatus` (server state, revalidate on mutation). All mutations SHALL show `Sonner` toasts in pt-BR. The component SHALL NOT use `dangerouslySetInnerHTML`. All labels follow the glossary ("Sessão", "Paciente").

#### Scenario: States are visually distinct
- **GIVEN** patients in each of the four states
- **WHEN** the panel renders for each
- **THEN** the badge, body copy, and primary action are different and match the spec

#### Scenario: Revocation requires typed confirmation
- **WHEN** the psychologist clicks `"Revogar termo"`
- **THEN** an `AlertDialog` opens with an input that must equal `"REVOGAR"` to enable the confirm button

#### Scenario: WCAG 2.1 AA contrast on badges
- **WHEN** the component renders in light and dark mode
- **THEN** every badge's foreground/background pair clears 4.5:1 contrast

#### Scenario: Optimistic update reverts on failure
- **WHEN** the revoke mutation fails (e.g., network)
- **THEN** the UI reverts to the previous `active` state and a `danger` toast is shown

### Requirement: Inngest event `ai-transcription/consent.revoked` is defined and dispatched

The system SHALL define `consentRevokedEventSchema` in `src/modules/ai-transcription/inngest/events.ts`:

```ts
{
  termId: z.string().uuid(),
  userId: z.string().uuid(),
  patientId: z.string().uuid(),
  revokedAt: z.coerce.date(),
  reason: z.string().max(500).nullable(),
}
```

The Inngest client SHALL be initialized in `src/modules/ai-transcription/inngest/client.ts`, registered in `src/app/api/inngest/route.ts`. In this change a stub function `onConsentRevokedStub` SHALL listen for the event and only log `{ event: 'ai-transcription/consent.revoked.received', termId, userId, patientId }` (NO `reason`, NO PII). Real cancellation logic for in-flight jobs lives in `ai-transcription-gemini-processing`.

#### Scenario: Event payload is Zod-validated before send
- **WHEN** `revokeAiConsentTerm` dispatches the event with malformed payload
- **THEN** Zod `.parse` throws; `inngest.send` is never called
- **AND** the error is logged without exposing field values

#### Scenario: Stub consumer received
- **WHEN** the event is dispatched
- **THEN** an Inngest run for `onConsentRevokedStub` is created
- **AND** a log line contains the three IDs and no PII

## MODIFIED Requirements

### Requirement: Default term template includes legally required content

The system SHALL provide a default consent term template for `kind = 'general'` that includes: psychologist identification (name, CRP), service description, LGPD data treatment clause (base legal: execução de contrato + tutela da saúde), data subject rights, retention period, **session recording policy reference (pointing to the separate `kind = 'ai_recording'` term when applicable)**, session fee, and cancellation policy. The psychologist MAY customize this template.

For `kind = 'ai_recording'`, the system SHALL use `AI_CONSENT_TEMPLATE_V1` (defined in the `ai-transcription-consent-flow` capability) as the canonical template. The two kinds are independent: a patient MAY have a signed general term and an unsigned AI term, and vice versa.

#### Scenario: Default general template no longer assumes recording consent inline
- **WHEN** a general consent term is generated
- **THEN** its body references that "AI recording is governed by a separate term" (instead of embedding recording clauses)

#### Scenario: AI term uses its own canonical text
- **WHEN** an AI term is generated
- **THEN** its `template_snapshot` equals `AI_CONSENT_TEMPLATE_V1`

### Requirement: RLS enforces owner-scoped access on consent_terms

The system SHALL keep RLS enabled on `consent_terms` with per-operation policies scoped by `user_id = auth.uid()`. The introduction of `kind` does NOT change the predicate — the same policy applies to both `general` and `ai_recording` rows.

#### Scenario: Cross-tenant read remains blocked
- **WHEN** psychologist B queries `consent_terms` for any patient of A (general OR ai_recording)
- **THEN** RLS returns zero rows

#### Scenario: No additional policy is needed for the new kind
- **WHEN** the migration completes
- **THEN** `pg_policies WHERE tablename = 'consent_terms'` returns the same number of rows as before, with predicates unchanged
