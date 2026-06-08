## 1. Allowlist parser (status → initial tab)

- [x] 1.1 Create `src/modules/ai-transcription/lib/transcription-list-tab.ts` exporting `TRANSCRIPTION_TABS`, the `TranscriptionTab` type, `DEFAULT_TRANSCRIPTION_TAB = 'pending'`, and `resolveInitialTabFromStatus(raw: string | string[] | undefined): TranscriptionTab`. Closed allowlist `{ ready: 'pending' }`; any non-string / unknown / empty value returns the default and never throws (design D1, RF-12.03/RF-12.16, RNF-12.05).
- [x] 1.2 Re-export `resolveInitialTabFromStatus` and the `TranscriptionTab` type from the module barrel `src/modules/ai-transcription/index.ts`.
- [x] 1.3 Unit test `src/__tests__/unit/modules/ai-transcription/lib/transcription-list-tab.test.ts`: assert `'ready'→'pending'`, `undefined→'pending'`, `'xyz'→'pending'`, `''→'pending'`, `['ready','reviewed']→'pending'`. Run `npm run test:unit` for this file.

## 2. Correct the dashboard AI-notes deep-link constant

- [x] 2.1 In `src/modules/dashboard/server/get-pendencias.ts`, change `AI_NOTES_AWAITING_REVIEW_HREF` from `/configuracoes/ia/transcricoes?status=ready` to `/dashboard/transcricoes?status=ready` (RF-12.02 / design D4). No other logic changes.
- [x] 2.2 Extend the existing `get-pendencias` integration test (under `src/__tests__/integration/`) to assert the returned `aiNotesAwaitingReviewHref === '/dashboard/transcricoes?status=ready'` for a seeded user, and that it does NOT contain `/configuracoes/ia/transcricoes`. Run the targeted integration spec.

## 3. Wire `searchParams.status` into the page and tabs

- [ ] 3.1 Add an optional `initialTab?: TranscriptionTab` prop to `TranscriptionsTabs` (`src/modules/ai-transcription/components/transcriptions-tabs.tsx`); set `<Tabs defaultValue={initialTab ?? 'pending'} ...>`. Keep it uncontrolled and leave all `data-testid`s unchanged (design D3).
- [ ] 3.2 Make `TranscricoesPage` (`src/app/(app)/dashboard/transcricoes/page.tsx`) async, accept `searchParams: Promise<{ status?: string | string[] }>`, resolve `initialTab` via `resolveInitialTabFromStatus`, and thread it through `TranscriptionListServer` into `<TranscriptionsTabs initialTab={...} />`. Preserve the `<Suspense>` boundary around the DB fetch (design D2, RNF-12.01/02).
- [ ] 3.3 Unit/RTL test for `TranscriptionsTabs` (`src/__tests__/unit/modules/ai-transcription/components/`): rendering with `initialTab="pending"` (and default/omitted) keeps `tab-pending` active; passing a non-default tab seeds that tab. Run `npm run test:unit` for this file.

## 4. E2E coverage (navigation + negative-auth)

- [ ] 4.1 E2E (seeded) in `src/__tests__/e2e/seeded/ai-transcription/`: seed a user with transcriptions in multiple buckets; from the dashboard click the AI-notes "Ver" link; assert the URL is `/dashboard/transcricoes?status=ready` and `tab-pending` / `panel-pending` is active on load (no client flip). (Acceptance: PRD 12 §9.)
- [ ] 4.2 E2E negative-auth: anonymous GET of `/dashboard/transcricoes?status=ready` redirects to `/login` (owed gating test; param preservation desirable, not required).
- [ ] 4.3 E2E degradation: authenticated load of `/dashboard/transcricoes?status=xyz` (with items) renders the default Pendentes tab with no error and no blank screen (RF-12.16 / RN-12.05).

