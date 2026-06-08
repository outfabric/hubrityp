# Design — pendencia-patients-consent-filter

## Context

Verified current state:

- `src/app/(app)/pacientes/page.tsx` — async Server Component. Reads `searchParams`, builds a `query` object (`page`, `pageSize`, `search`, `status`, `tags`, `sort`, `order`) and calls `listPatientsImpl(supabase, query)` inside `<Suspense>`. **Does not read `filtro`.**
- `src/modules/patients/server/list-patients.ts` (`listPatientsImpl`) — authenticates via `getUser()`, validates with `listPatientsQuerySchema`, builds dynamic `conditions: SQL[]` (always `eq(patients.userId, userId)`), runs rows + `count()` in `Promise.all`. Returns `Patient[]` (full row: includes `phone`, `patientType`, `consentSignedAt`, `archivedAt`). **No guardian join.**
- `src/modules/patients/components/patient-detail-header.tsx` — `'use client'`. Defines `extractPhoneDigits()` and `buildConsentWhatsAppHref(phone, consentUrl)` as **private module functions**, resolves the consent token lazily on click (`generateConsent` Server Action, reusing a pending token), and picks the guardian's phone for minors. This is the exact behavior the row actions must mirror.
- The dashboard count predicate (`get-pendencias.ts`): `isNull(consentSignedAt) AND isNull(archivedAt)`, owner-scoped — the single source of truth to reuse (RN-12.03).

## Goals / Non-goals

**Goals**
- `/pacientes?filtro=sem-consentimento` lands on a list filtered by the count predicate, with a removable chip, per-row copy-link / WhatsApp actions, count parity, and a positive empty state.
- Reuse the existing consent generate/token-reuse + WhatsApp helpers without divergence.

**Non-goals**
- No consent data-model change; no change to generate/sign/revoke actions or the minor→guardian rule.
- No automated WhatsApp sending (Twilio/WABA stays out of scope — RF-12.14d).
- No redesign of the patients list beyond what the filter + row actions require.

## Decisions

### D1 — `filtro` allowlist parser (server-side)

Add `src/modules/patients/lib/patient-list-filter.ts`:

```ts
export const PATIENT_LIST_FILTERS = ['sem-consentimento'] as const;
export type PatientListFilter = (typeof PATIENT_LIST_FILTERS)[number];

/** Closed allowlist. Unknown/empty/array → null (no filter). Never throws. */
export function resolvePatientListFilter(
  raw: string | string[] | undefined,
): PatientListFilter | null {
  return typeof raw === 'string' && (PATIENT_LIST_FILTERS as readonly string[]).includes(raw)
    ? (raw as PatientListFilter)
    : null;
}
```

Mirrors the change-1 allowlist pattern (RF-12.03 / RNF-12.05). Re-export from the module barrel.

### D2 — `listPatientsImpl` gains an optional `missingConsent` predicate

- Extend `listPatientsQuerySchema` + `ListPatientsQuery` with optional `missingConsent?: boolean` (default `false`).
- When `missingConsent` is true, push **both** `isNull(patients.consentSignedAt)` and `isNull(patients.archivedAt)` into `conditions` — matching the count predicate exactly, regardless of the `status` param. (Pushing `archivedAt IS NULL` explicitly avoids a double-filter surprise when `status` is unset/`all`.)
- The predicate is part of the same `whereClause` used by both the rows query and the `count()` query → header count parity (RF-12.18) is automatic.

The page maps `resolvePatientListFilter(searchParams.filtro) === 'sem-consentimento'` → `query.missingConsent = true`. The page never injects raw SQL or the predicate itself (RN-12.03).

### D3 — Row-action enrichment without N+1 (guardian phone + share-phone)

The WhatsApp action needs a phone; for minors that is the **guardian's** phone, which the current query does not return. Decision:

- Only when `missingConsent` is true, after fetching the ≤`pageSize` rows, run **one** batched query for the minors on that page:
  `SELECT patient_id, phone FROM patient_guardians WHERE patient_id IN (<minorIdsOnPage>)` picking the primary guardian (existing primary-guardian rule), then resolve **server-side** the per-row `sharePhone`:
  - adult (`individual`/`couple`) → `patient.phone`
  - minor (`child`/`adolescent`) → primary guardian's phone
- Return a small parallel array `consentShare: { patientId: string; sharePhone: string | null }[]` (only when the filter is active). This keeps `Patient[]` stable and puts the minor→guardian decision on the server (the trust boundary), so the client only needs presence-of-phone to enable/disable and the digits to build `wa.me`.

One extra indexed query over ≤25 ids is well within the perf budget (RNF-12.02); no per-row query.

> **Token is NOT pre-fetched.** Pre-generating terms for every filtered patient would create consent terms en masse. The token is resolved **lazily on click** (D5), exactly like the detail header. Row enable/disable depends only on `sharePhone`, not on the token.

### D4 — Extract the consent-share helpers into a shared lib (rule of three)

`buildConsentWhatsAppHref` / `extractPhoneDigits` / the canonical message text are currently private to `patient-detail-header.tsx`. They are now needed in a second place (the row action). Extract to `src/modules/patients/lib/consent-share.ts`:

```ts
export function extractPhoneDigits(phone: string): string;
export function buildConsentWhatsAppHref(phone: string, consentUrl: string): string; // canonical message
export function buildConsentUrl(origin: string, token: string): string; // `${origin}/termo/${token}`
```

Import in both `patient-detail-header.tsx` (replace the private copies — no behavior change) and the new row-action component. Single source prevents the message/format from diverging (PRD RF-12.14b: "reuse the existing helper").

### D5 — Row action component (client leaf)

Add a client component (e.g. `patient-consent-row-actions.tsx`) rendered per row **only when the consent filter is active**:

- Props: `patientId`, `sharePhone: string | null`, `generateConsentAction` (the existing Server Action, passed from the server page — actions can't be imported into client components directly).
- **Copiar link:** `onClick` → `generateConsentAction(patientId)` (reuses pending token, no duplicate) → `buildConsentUrl(window.location.origin, token)` → `navigator.clipboard.writeText(url)` → toast "Link copiado". Errors → sanitized toast.
- **Enviar por WhatsApp:** rendered as a `<Button>` (not an anchor, because the token resolves on click). `disabled = !sharePhone`; when disabled, wrap in the existing `Tooltip` with "Cadastre um telefone para enviar pelo WhatsApp" (RF-12.14c). On click → resolve token (as above) → `window.open(buildConsentWhatsAppHref(sharePhone, url), '_blank', 'noopener,noreferrer')`.
- The token-gated URL is built client-side and **never logged** (PRD §11); the message contains only the link.

### D6 — Active-filter chip + empty state

- The list client component renders a removable chip ("Sem consentimento · N") when `filtro=sem-consentimento`. Remove control (`✕`, keyboard-focusable, `aria-label`) calls `router.replace` dropping only the `filtro` param → full list (RF-12.13 / RNF-12.03). Reuse the URL-sync the list already does for other params.
- When `missingConsent` is active and `total === 0`, render the positive empty state "Nenhum paciente sem consentimento pendente." with a link to `/pacientes` (RF-12.19) — decided from `filtro active && total === 0`, not the generic search-empty state.

### Design-system note

Chip uses the Sálvia `Badge` (existing `@/shared/ui/badge`); row actions use `Button` (ghost/sm) + `Tooltip` + Lucide icons (`Copy`/`Link`, `MessageCircle`, `Check`) — same primitives already used in `patient-detail-header.tsx`, so visual parity is inherited. (Read `docs/design-system/rules.md` before implementing the chip/actions.)

## Security / LGPD

- Filter predicate is owner-scoped server-side (`eq(userId)`) + RLS; no `filtro`/URL combination widens scope (RN-12.02). A **cross-tenant integration test** is mandatory.
- `/pacientes` already middleware-gated; **negative-auth E2E** for the deep-link is owed.
- Consent link is token-gated/sensitive: copied/opened client-side, never logged in full; the WhatsApp message carries only the link, no clinical data (PRD §11).
- Allowlist validation blocks URL-injected filters (RNF-12.05); errors from `generateConsent` surface as sanitized toasts, no stack/PII.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Extracting helpers from `patient-detail-header.tsx` regresses the ficha actions | Pure move + re-import; unit-test the extracted helpers; the detail-header behavior is unchanged. |
| Guardian enrichment introduces N+1 | One batched `IN (...)` query over the ≤25 minors on the page (D3). |
| Mass token generation | Token resolved lazily per click only (D5); no pre-generation. |
| `status` param interacting with the consent predicate | Push `archivedAt IS NULL` explicitly so the result equals the count predicate regardless of `status` (D2). |
| Consent predicate seq-scan at scale | Owner-scope index already serves it; note an optional partial index `(user_id) WHERE consent_signed_at IS NULL AND archived_at IS NULL` as a future perf tweak (not in this change — no migration). |

## Test strategy

- **Unit** (`src/__tests__/unit/modules/patients/lib/`): `resolvePatientListFilter` allowlist (`'sem-consentimento'→…`, unknown/empty/array→null); `consent-share` helpers (`extractPhoneDigits`, `buildConsentWhatsAppHref` message+digits, `buildConsentUrl`). If share-phone selection is extracted as a pure fn, cover adult vs `child`/`adolescent`.
- **Integration** (`src/__tests__/integration/patients/`): `listPatientsImpl` with `missingConsent` — parity with the count predicate; excludes signed/archived; composes with `search`/`tags`/pagination; archived+consent → empty; **cross-tenant scope** (two seeded users, A never sees B); guardian-phone enrichment returns the primary guardian's phone for minors and `patient.phone` for adults.
- **E2E (seeded)** (`src/__tests__/e2e/seeded/patients/`):
  - Dashboard "Ver" (pacientes sem consentimento) → `/pacientes?filtro=sem-consentimento`, only unconsented patients listed, chip visible with count.
  - Copy link: click → toast "copiado"; a single pending consent term exists (second click does not duplicate).
  - WhatsApp: adult → `wa.me/<patient digits>`; minor → `wa.me/<guardian digits>`; both messages contain `/termo/<token>`.
  - Disabled-without-phone: WhatsApp disabled + tooltip; copy-link still works.
  - Remove chip → URL drops `filtro`, full list returns.
  - **Negative-auth:** anonymous `/pacientes?filtro=sem-consentimento` → `/login`.

## Rollout

Forward-only, no migration, reversible by reverting the parser/page/query/component changes. Reuses the allowlist pattern from `fix-pendencia-ai-notes-deeplink`; independent of `pendencia-overdue-evolutions-list`.
