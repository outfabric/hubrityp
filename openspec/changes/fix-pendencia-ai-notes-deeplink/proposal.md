## Why

The dashboard's "Pendências" section counts AI notes awaiting review correctly, but the "Ver" link is broken: `AI_NOTES_AWAITING_REVIEW_HREF` points at `/configuracoes/ia/transcricoes?status=ready` — a **route that does not exist**. The real list lives at `/dashboard/transcricoes`, and even there the page ignores the `status` parameter, so the user lands on the default tab and must hunt for their pending queue. For a non-technical psychologist, a "Ver" link that goes nowhere (or to the wrong place) reads as "this count is not trustworthy" and erodes confidence in the dashboard they open every day (PRD 12, §1).

This is the smallest of the three PRD-12 destinations and the right place to establish the shared **deep-link allowlist contract** (PRD 12, RF-12.01/RF-12.03) that the patients and agenda destinations will reuse.

## What Changes

- **Fix the canonical href (RF-12.02):** `AI_NOTES_AWAITING_REVIEW_HREF` in `src/modules/dashboard/server/get-pendencias.ts` changes from `/configuracoes/ia/transcricoes?status=ready` (non-existent) to `/dashboard/transcricoes?status=ready` (the real list route). The href stays a static, server-owned constant — no client input.
- **Make `/dashboard/transcricoes` honor `?status=ready` (RF-12.15):** the Server Component reads `searchParams.status` and, when it equals `ready`, renders with the **"Pendentes"** tab pre-selected server-side (no flash of the default tab before switching).
- **Closed allowlist with graceful degradation (RF-12.03/RF-12.16):** the only accepted value is `ready` (MVP). Any other or missing value (`?status=xyz`, absent) renders the default tab with no error — never an exception or blank screen. Validated server-side as defense against filter injection (RNF-12.05).
- **First-paint correctness (RNF-12.01):** the active tab is decided on the server from `searchParams`, so the correct segment is shown on the first render.
- The displayed count of pending notes already derives from the same predicate as the dashboard count (`status = 'ready'`, owner-scoped) — this change does **not** touch the business rule, only the navigation contract (PRD 12, RN-12.03 / RF-12.18).

This change does **not** add new tabs, alter the `ready`/`reviewed`/`failed` bucketing, or change any data model.

## Capabilities

### New Capabilities

_None._ This change corrects navigation behavior on existing surfaces.

### Modified Capabilities

- `dashboard-home`: the "Seção Pendências" requirement is updated so the AI-notes pendência links to the **correct, existing** route (`/dashboard/transcricoes?status=ready`) and so the three pendência hrefs are documented as the canonical, static, allowlisted deep-link contract (the source of truth each destination must honor).
- `ai-transcription-review-ui`: the "`/dashboard/transcricoes` lists transcriptions awaiting review" requirement gains server-side interpretation of `?status=ready` — opening the "Pendentes" tab on first paint — with a closed allowlist (`ready` only) that degrades gracefully to the default tab for unknown/absent values.

## Impact

- **Code:**
  - `src/modules/dashboard/server/get-pendencias.ts` — single-line constant correction.
  - `src/app/(app)/dashboard/transcricoes/page.tsx` — read and validate `searchParams.status`; pass the resolved initial tab down.
  - `src/modules/ai-transcription/components/transcriptions-tabs.tsx` — accept an `initialTab` prop instead of a hardcoded `defaultValue="pending"`.
  - Likely a small allowlist helper (e.g. parse `status` → `'pending' | 'reviewed' | 'failed'` initial tab) in `src/modules/ai-transcription/lib/`.
- **Routes/auth:** no new routes. `/dashboard/transcricoes` is already gated by middleware (`/dashboard` is in `APP_PREFIXES`); a **negative-auth E2E test** is still owed for the deep-linked path.
- **Data model / migrations:** none.
- **Security/LGPD:** the href carries only a route + an allowlisted status (no PII); owner-scoping and RLS on the transcriptions query are unchanged. Allowlist validation prevents URL-injected filters.
- **Tests:** unit (allowlist parser), integration (page resolves the correct initial tab from `searchParams`; unknown value degrades), E2E (dashboard "Ver" → lands on Pendentes tab; anonymous deep-link → `/login`).
- **Dependencies:** none new. Sibling PRD-12 changes (`pendencia-patients-consent-filter`, `pendencia-overdue-evolutions-list`) reuse the allowlist-contract pattern established here.
