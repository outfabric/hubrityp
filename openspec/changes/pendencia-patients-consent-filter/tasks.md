## 1. `filtro` allowlist parser

- [x] 1.1 Create `src/modules/patients/lib/patient-list-filter.ts` exporting `PATIENT_LIST_FILTERS`, `PatientListFilter`, and `resolvePatientListFilter(raw: string | string[] | undefined): PatientListFilter | null` (closed allowlist `['sem-consentimento']`; unknown/empty/array → null; never throws — design D1, RF-12.03/RNF-12.05).
- [x] 1.2 Re-export the parser and type from the module barrel `src/modules/patients/index.ts`.
- [x] 1.3 Unit test `src/__tests__/unit/modules/patients/lib/patient-list-filter.test.ts`: `'sem-consentimento'→'sem-consentimento'`, `'xyz'→null`, `''→null`, `undefined→null`, `['sem-consentimento']→null`. Run `npm run test:unit`.

## 2. Extract and reuse the consent-share helpers

- [x] 2.1 Create `src/modules/patients/lib/consent-share.ts` exporting `extractPhoneDigits(phone)`, `buildConsentWhatsAppHref(phone, consentUrl)` (canonical "Olá! Segue o link…" message), and `buildConsentUrl(origin, token)` (`${origin}/termo/${token}`) — moved verbatim from `patient-detail-header.tsx` (design D4).
- [x] 2.2 Update `src/modules/patients/components/patient-detail-header.tsx` to import these from the new lib and delete the private copies — no behavior change.
- [x] 2.3 Unit test `src/__tests__/unit/modules/patients/lib/consent-share.test.ts`: `extractPhoneDigits` strips non-digits; `buildConsentWhatsAppHref` builds `https://wa.me/<digits>?text=<encoded message containing the url>`; `buildConsentUrl` returns `${origin}/termo/${token}`. Run `npm run test:unit`.

## 3. `listPatientsImpl` consent predicate + row enrichment

- [x] 3.1 Extend `listPatientsQuerySchema` and `ListPatientsQuery` (`src/modules/patients/lib/`) with optional `missingConsent?: boolean` (default false).
- [x] 3.2 In `listPatientsImpl` (`src/modules/patients/server/list-patients.ts`), when `missingConsent` is true push `isNull(patients.consentSignedAt)` and `isNull(patients.archivedAt)` into the shared `conditions` (so rows and `count()` stay consistent → parity, RF-12.18; matches the get-pendencias predicate exactly, RN-12.03).
- [x] 3.3 When `missingConsent` is true, after fetching the page rows run ONE batched query for the primary-guardian phone of the minor (`child`/`adolescent`) patients on the page (`WHERE patient_id IN (...)`), then resolve a server-side `sharePhone` per row (adult → `patient.phone`; minor → guardian phone) and return a `consentShare: { patientId, sharePhone }[]` alongside the existing result (design D3 — no N+1, no token pre-generation).
- [x] 3.4 Integration test `src/__tests__/integration/patients/consent-filter.int.test.ts`: seed signed/unsigned/archived patients → `missingConsent` returns exactly the count predicate set; composes with `search`/`tags`/pagination; archived+consent → empty; `sharePhone` is the guardian's phone for a minor and the patient's for an adult. Run the targeted integration spec.
- [x] 3.5 Integration cross-tenant test: seed psychologists A and B each with unconsented patients; assert A's `missingConsent` listing never returns B's rows (RN-12.02). Add to the same spec or `src/__tests__/integration/patients/`.

## 4. Page wiring: parse `filtro`, thread filter state

- [x] 4.1 In `src/app/(app)/pacientes/page.tsx`, parse `searchParams.filtro` via `resolvePatientListFilter`; set `query.missingConsent = true` when it resolves to `sem-consentimento`; pass the active-filter flag + `consentShare` data + the `generateConsent` Server Action down through `PatientListLoader` to the list (first-paint server filtering, RNF-12.01).
- [x] 4.2 When `missingConsent` is active and `total === 0`, render the positive empty state "Nenhum paciente sem consentimento pendente." with a link to `/pacientes` (RF-12.19) — distinct from the generic search-empty state.

## 5. UI: active-filter chip + per-row consent actions

- [x] 5.1 Read `docs/design-system/rules.md` (Sálvia) before building UI. Add a removable active-filter chip (`Badge` + keyboard-focusable `✕`, `aria-label`/live region per RNF-12.03) shown when `filtro=sem-consentimento`; removing it `router.replace`s the URL without `filtro` and returns to the full list (RF-12.13).
- [x] 5.2 Create `src/modules/patients/components/patient-consent-row-actions.tsx` (`'use client'`): **Copiar link** → call `generateConsentAction(patientId)` (reuse pending token, no duplicate) → `buildConsentUrl(window.location.origin, token)` → clipboard + "Link copiado" toast; **Enviar por WhatsApp** → `<Button disabled={!sharePhone}>` (tooltip "Cadastre um telefone para enviar pelo WhatsApp" when disabled) → resolve token on click → `window.open(buildConsentWhatsAppHref(sharePhone, url))`. Never log the token-gated URL (RF-12.14a/b/c, PRD §11).
- [x] 5.3 Render the row actions in the patient list only when the consent filter is active.
- [x] 5.4 Unit/RTL test for `patient-consent-row-actions`: copy path writes the `/termo/{token}` URL and toasts; WhatsApp button disabled (with tooltip) when `sharePhone` is null and enabled otherwise. Run `npm run test:unit`.

## 6. E2E coverage (flows + negative-auth)

- [ ] 6.1 E2E (seeded) `src/__tests__/e2e/seeded/patients/`: dashboard "Ver" (pacientes sem consentimento) → `/pacientes?filtro=sem-consentimento`; only unconsented patients listed; chip visible with count matching the dashboard (PRD §9).
- [ ] 6.2 E2E copy link: click → "copiado" feedback; assert a single pending consent term exists (second click does not duplicate).
- [ ] 6.3 E2E WhatsApp: adult → `wa.me/<patient digits>`; minor → `wa.me/<guardian digits>`; message contains `/termo/<token>`. Disabled-without-phone → button disabled + tooltip, copy-link still works.
- [ ] 6.4 E2E remove chip → URL drops `filtro`, full list returns; unknown `?filtro=xyz` renders the full list without error (RF-12.16).
- [ ] 6.5 E2E negative-auth: anonymous `/pacientes?filtro=sem-consentimento` redirects to `/login`.
