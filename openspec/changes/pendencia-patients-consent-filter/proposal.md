## Why

The dashboard "Pendências" section counts patients without consent correctly and links to `/pacientes?filtro=sem-consentimento`, but the patients list **ignores `filtro`** (it only understands `page`, `search`, `status`, `tags`, `sort`, `order`). Clicking "Ver" dumps the psychologist into the full, unfiltered list with no way to tell which patients are the pendência — the ver → clicar → resolver loop breaks at the middle step (PRD 12, §1). The psychologist then has to hunt manually and resolve consent outside the guided flow, eroding trust in the dashboard count.

This change closes that loop for Destination B: `/pacientes?filtro=sem-consentimento` lands on a list filtered to exactly the patients in the count, each row carrying the shortcuts the psychologist already uses to get a consent term signed — copy the token-gated link and send it over their own WhatsApp.

## What Changes

- **Interpret `filtro=sem-consentimento` server-side (RF-12.11):** `/pacientes` reads `searchParams.filtro` and, when it matches the allowlist, restricts the listing to the **same predicate the count uses** — `consent_signed_at IS NULL AND archived_at IS NULL`, owner-scoped (RF-12.04 / RN-12.03). The predicate is added to `listPatientsImpl`, not reimplemented in the page.
- **Closed allowlist + graceful degradation (RF-12.03/RN-12.05):** the only accepted `filtro` value is `sem-consentimento` (MVP). Unknown/empty/array values are ignored — the full default list renders, no error. Validated server-side (RNF-12.05).
- **Coexistence with existing params (RF-12.12):** `filtro` composes with `search`, `status`, `tags`, `sort`, `order`, `page` and restricts the set **before** pagination so count/pages stay correct.
- **Active-filter chip (RF-12.13 / RNF-12.03):** a removable badge ("Sem consentimento · N ✕") announces the active filter to screen readers; one click clears `filtro` and returns to the full list.
- **Per-row consent-share actions (RF-12.14), reusing existing behavior:**
  - **Copiar link do termo (RF-12.14a):** copies the token-gated `/termo/{token}` with "copiado" feedback. If no pending term exists it first generates one via the existing `generateConsent` Server Action, **reusing the pending token without duplicating** (same rule as the patient ficha).
  - **Enviar por WhatsApp (RF-12.14b):** opens `wa.me` with the pre-filled message via the existing `buildConsentWhatsAppHref(phone, consentUrl)` helper, **using the guardian's phone when the patient is a minor** (`child`/`adolescent`).
  - **Disabled state (RF-12.14c):** WhatsApp is disabled with an explanatory tooltip when no phone (patient or guardian) is available; **copy-link stays available** as the fallback.
- **Count parity + positive empty state (RF-12.18/12.19):** the filtered header count equals the dashboard count for the same user at the same instant; reaching the destination with zero matches shows "Nenhum paciente sem consentimento pendente." with a link to the full list — never the full list unexplained.
- **First-paint filtering (RNF-12.01):** applied server-side via `searchParams`, no flash of the unfiltered list.

This change does **not** alter the consent-term data model, the generate/sign/revoke Server Actions, the minor→guardian rule, or any other patients list filter. It reuses the WhatsApp automation boundary unchanged — automated sending via Twilio/WABA stays **out of scope** (RF-12.14d).

## Capabilities

### New Capabilities

_None._ This change extends an existing surface and reuses existing consent behavior.

### Modified Capabilities

- `patient-listing`: gains (1) the `filtro=sem-consentimento` server-side filter with closed allowlist and graceful degradation, composing with existing params before pagination; (2) a removable active-filter chip indicator with the count; (3) per-row consent-share actions (copy token-gated link, send via WhatsApp with the minor→guardian rule and disabled-without-phone behavior) surfaced inline when the consent filter is active; (4) a positive, specific empty state and count parity with the dashboard pendência.

_Reused unchanged (dependencies, not modified):_ `patient-consent` (the `generateConsent` Server Action, token reuse rule, `buildConsentWhatsAppHref`, minor→guardian term routing) and `patient-detail` (the existing copy/WhatsApp action pattern this change mirrors at row level).

## Impact

- **Code:**
  - `src/app/(app)/pacientes/page.tsx` — parse/validate `searchParams.filtro`; thread a `missingConsent` flag and the active-filter state into the list.
  - `src/modules/patients/server/list-patients.ts` (`listPatientsImpl`) — accept an optional consent-filter flag applying the count predicate; when active, return the per-row fields the actions need (phone, `patient_type`, and the primary guardian's phone for minors) without an N+1.
  - `src/modules/patients/lib/` — small allowlist parser for `filtro` (mirrors the change-1 pattern) + the patient-list query schema gains the optional flag.
  - `src/modules/patients/components/patient-list.tsx` (and row component) — render the active-filter chip and the per-row Copiar link / Enviar WhatsApp actions (client leaf), reusing `buildConsentWhatsAppHref` / `extractPhoneDigits` and calling the existing `generateConsent` Server Action lazily on click.
- **Routes/auth:** no new routes. `/pacientes` is already gated by middleware; a **negative-auth E2E test** for the deep-linked path is owed, plus a **cross-tenant scope test** proving no `filtro`/URL value exposes another psychologist's patients (RN-12.02).
- **Data model / migrations:** none.
- **Security/LGPD:** filter is owner-scoped server-side + RLS — UI filter never widens scope (RN-12.02). The consent link is **token-gated and sensitive**: it is copied/opened client-side and **never logged in full** (PRD 12, §11); the WhatsApp message carries only the link, no clinical data. Allowlist validation blocks URL-injected filters (RNF-12.05).
- **Tests:** unit (allowlist parser; minor→guardian phone selection; WhatsApp-disabled-without-phone logic), integration (`listPatientsImpl` consent filter parity with the count predicate; composition with `search`/`tags`/pagination; cross-tenant scope), E2E (dashboard "Ver" → filtered list; copy-link generates+reuses token; WhatsApp `wa.me` correct number incl. minor; disabled-without-phone; remove chip → full list; anonymous deep-link → `/login`).
- **Dependencies:** reuses the allowlist-contract pattern from `fix-pendencia-ai-notes-deeplink`; reuses `patient-consent` Server Actions/helpers. Sibling change `pendencia-overdue-evolutions-list` is independent.
