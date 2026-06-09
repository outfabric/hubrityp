## 1. Backend — types, schemas, and pure helpers

- [x] 1.1 In `src/modules/sessions/lib/`, add the Zod input schema for the history read: `patientId` (uuid), optional `cursor` (string), optional `status` enum (`done | cancelled | no_show`), `limit` int clamped 1–50 default 12. Derive types via `z.infer`. Export the discriminated-union result types (`{ ok: true; summary?; futureSession?; sessions; nextCursor } | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'ERROR' }`).
- [x] 1.2 Add a pure helper `computeAttendanceRate({ done, cancelledByPatient, noShow })` returning an integer percentage, with denominator = `done + cancelledByPatient + noShow` and `0%` when the denominator is 0 (RN-13.03; therapist/NULL cancellations excluded by the caller's query, not here).
- [x] 1.3 **Unit test** the input schema (valid/invalid `patientId`, `limit` clamping, `status` enum) and `computeAttendanceRate` (8/(8+1+1)=80%, all-cancelled=0%, zero-denominator=0%) — co-located mirror under `src/__tests__/unit/modules/sessions/`.

## 2. Backend — summary aggregate query

- [x] 2.1 Implement `getPatientSessionSummary` (server, `import 'server-only'`) as a single aggregate query over visible sessions (`user_id = :uid AND patient_id = :pid AND deleted_at IS NULL AND is_blocking = false`) using `count(*) filter (where ...)`: `doneTotal`, `cancelledByPatient` (`status='cancelled' AND cancelled_by='patient'`), `noShow`, `doneWithoutEvolution` (`LEFT JOIN evolutions e ON e.session_id = s.id`, count where `status='done' AND e.id IS NULL`), and `lastDoneAt` (`max(start_at) filter (where status='done')`). Owner-scope every condition on `user_id` (RF-13.01, RF-13.02, RN-13.04).
- [x] 2.2 **Integration test** (Testcontainers + RLS) the summary: correct `doneTotal`, attendance denominator excludes therapist/NULL cancellations (RN-13.03), `doneWithoutEvolution` reflects the evolution join (RN-13.04), `lastDoneAt` is the newest `done`, and soft-deleted/blocking rows are excluded (RN-13.01, RN-13.02). Include a cross-tenant case proving psychologist A sees none of B's data.

## 3. Backend — paginated list + future session

- [x] 3.1 Implement `getPatientSessionHistoryList` (server-only): historical list ordered `start_at DESC, id DESC`, paginated with the `limit + 1` look-ahead, cursor = last row's `(start_at, id)`; exclude soft-deleted/blocking and the nearest-future session id. `LEFT JOIN evolutions` selecting only `evolutions.id` and `evolutions.finalized_at`. **Couple-safe projection**: select only `patient_ids IS NOT NULL` as a boolean — never the partner id/name (LGPD-13.03, RN-13.06). Resolve the "Remarcada de [data]" original date via an owner-scoped self-join limited to `start_at` (most recent reschedule only). Optional `status` filter param (RF-13.03, RF-13.04, RF-13.05, RF-13.11, RF-13.12).
- [x] 3.2 Implement `getNearestFutureSession` (server-only): single `scheduled|confirmed` with `start_at >= now()`, ordered `start_at ASC`, limit 1, owner-scoped, excluding soft-deleted/blocking (RF-13.04).
- [x] 3.3 **Integration test** the list + future-session queries: 12-per-page pagination with correct cursor/`nextCursor`, status filter param, only the nearest future session returned for a 20-session recurrence, soft-deleted/blocking excluded, evolution join (`finalized_at`) present, and — critically — the couple-session payload contains **no partner identifier**. Assert the query plan uses `sessions_patient_id_start_at_idx` (no seq scan) (RNF-13.03).

## 4. Backend — read entrypoint, audit, and Server Action wiring

- [x] 4.1 Implement `getPatientSessionHistoryImpl(supabase, input)`: authenticate via `supabase.auth.getUser()` (never `getSession()`), validate with the Zod schema, owner-scope on the verified `user.id`. When `cursor` is absent (initial open): run summary + nearest-future + first page and return all three. When `cursor` is present: run only the list page. Return the sanitized discriminated-union result; log internal errors without PII (RF-13.02, D2, D7).
- [x] 4.2 On initial open only, write one `audit_log` entry (`action: 'patient.session_history.read'`, `resource_type: 'patient'`, `resource_id: patientId`, verified `user_id`) via direct Drizzle, best-effort (failure logged without PII, does not fail the read). No audit on `cursor` calls (LGPD-13.01).
- [x] 4.3 Expose the impl through the server-only `src/modules/sessions/server.ts` barrel and add the thin `'use server'` Server Action wrapper used by the client (create the RLS-scoped Supabase client from cookies at the call site). Do NOT export the impl from the client-safe `index.ts`.
- [x] 4.4 **Integration test** the entrypoint: unauthenticated → `{ ok: false, code: 'UNAUTHORIZED' }`; cross-tenant `patientId` → no other tenant's rows; exactly one `audit_log` row on initial open and **zero** on a `cursor` (load-more) call; audit row contains only identifiers (no name/notes). This is the mandatory negative-auth coverage at the action layer.

## 5. Frontend — presentation utilities (module lib)

- [x] 5.1 Add client-safe helpers in `src/modules/sessions/lib/`: SP-timezone month/year group key + label via `formatInTimeZone(..., 'America/Sao_Paulo', ...)` with `pt-BR` (dez→jan correct); full-date-with-weekday and time-range formatters; the status → `{ badgeVariant, lucideIcon, label }` map (RF-13.06); the modality → icon map (`MapPin`/`Video`); and `isFinalizedReadOnly(finalizedAt)` = set AND older than 30 days (RN-13.05).
- [x] 5.2 **Unit test** the helpers: month grouping across the year boundary, status/modality maps, and `isFinalizedReadOnly` (set+>30d = true, set+10d = false, null = false).

## 6. Frontend — session card

- [x] 6.1 Build `SessionHistoryCard` (`'use client'`) as a Sálvia `interactive` card (bg `surface`, border `border`, radius `xl`, shadow `xs`, padding `space-6`/`space-4` mobile, hover `border-strong`): status badge+Lucide icon+label, full date + weekday, time range, duration, and — only when present — modality icon, location name, amount. Render `neutral` tags "Sessão de casal", "Remarcada de [data]", "Registro retroativo". For `done`: evolution indicator — `success` "Evolução registrada" + `link` "Ver" (→ `/pacientes/:id/prontuario/evolucoes/:evolutionId`, with subtle "Finalizada" when read-only) or `warning` "Sem evolução" + `primary` "Registrar" (→ `.../evolucoes/nova?sessionId=:id`). For `cancelled`: show who/reason/notice/charged. Icons `aria-hidden`; standalone controls labelled (RF-13.05–13.08, RF-13.15, RN-13.04, RN-13.05, RN-13.06).
- [x] 6.2 **Unit test** (RTL) the card variants: done-with/without-evolution CTAs and hrefs, "Finalizada" hint visibility, non-`done` shows no evolution indicator, couple tag present with no partner data in the DOM, rescheduled/late tags, cancelled details, optional fields omitted when absent.

## 7. Frontend — summary strip and filter chips

- [x] 7.1 Build `SessionHistorySummaryStrip` (realized total, attendance rate with `0%` shown, `warning` pending-evolution badge hidden when zero, last-session date) and `SessionHistoryFilterChips` (single-select: Todas/Realizadas/Canceladas/Não compareceu) per Sálvia tokens (RF-13.01, RF-13.10, §8 zero-rate edge case).
- [x] 7.2 **Unit test** (RTL) the strip (badge hidden at zero, `0%` rendering) and the chips (single-select toggle, default "Todas").

## 8. Frontend — history view container

- [x] 8.1 Build `PatientSessionHistory` (`'use client'`) using TanStack Query `useInfiniteQuery` against the Server Action: fetch the first page on mount (lazy — relies on Radix `TabsContent` mounting on activation, no `forceMount`), render month dividers + "Próxima sessão"/"Sessões anteriores" separators, the "Carregar mais (N)" `secondary` button with spinner loading state and remaining count (hidden when exhausted, scroll preserved, filter preserved), the 3-card skeleton (`prefers-reduced-motion`), the error state ("Tentar novamente" retries), and the empty state (`Calendar` icon, "Nenhuma sessão registrada", description naming the patient, `primary` "Agendar primeira sessão" → `/agenda`). Encapsulate the ≤50 client-filter vs >50 server-filter decision in one hook; the future session stays visible regardless of filter (RF-13.04, RF-13.10–13.14, RF-13.16–13.19).
- [x] 8.2 **Unit test** the hybrid-filter hook: ≤50 loaded filters client-side (no refetch), >50 switches to a server-parameterized query key and resets pagination, future session excluded from the filtered list.

## 9. Frontend — integration into PatientTabs, page, and agenda deep-link

- [ ] 9.1 Add a `sessionsContent: ReactNode` prop to `PatientTabs` (`src/modules/patients/components/patient-tabs.tsx`); render it in the `sessions` `TabsContent` instead of the placeholder; keep `Calendar` icon and `data-testid="patient-tab-content-sessions"`. Wire `src/app/(app)/pacientes/[id]/page.tsx` to pass `<PatientSessionHistory patientId=... patientName=... />`. Keep Financeiro as the placeholder.
- [ ] 9.2 Handle `?focusSession=:id` in the agenda page (`src/app/(app)/agenda/page.tsx` + calendar loader): read the param and focus/position the calendar on that owner-scoped session; add the `ghost` "Abrir na agenda" button (Lucide `ArrowRight`) on the future-session card linking to `/agenda?focusSession=:id` (RF-13.09).
- [ ] 9.3 **Integration test** (RTL with real providers) the wired tab: opening the sessions tab renders the history (summary + list), the empty state renders for a patient with no sessions, and the placeholder is gone; assert the Financeiro tab still shows "Em breve".

## 10. E2E — seeded suite

- [ ] 10.1 Add `src/__tests__/e2e/seeded/patient-session-history/*.spec.ts`: open the tab and see the summary + grouped list; apply a status filter; "Carregar mais" appends a page; "Registrar" / "Ver" CTAs navigate to the correct evolution URLs; couple session shows the tag with no partner data; empty-state CTA goes to `/agenda`; "Abrir na agenda" deep-links with `?focusSession=`.
- [ ] 10.2 **E2E negative-auth test**: an anonymous visit to `/pacientes/:id` redirects to `/login` (middleware gating), proving the gated surface is not reachable without a session.
