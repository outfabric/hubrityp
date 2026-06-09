## Context

PRD 13 turns the "Histórico de sessões" tab of `/pacientes/:id` (today an "Em breve" placeholder in `PatientTabs`) into a read-oriented, single-patient session view. The data already exists; nothing new is persisted.

Current state confirmed by inspection:

- **`sessions`** (`src/shared/db/schema/agenda/tables.ts`) already carries every field the PRD needs: `status` (`scheduled|confirmed|done|cancelled|no_show`), `startAt`/`endAt`/`durationMinutes`, `modality`, `locationId`, `amount` (text, BRL decimal-safe), `patientId`, `patientIds` (couple), `isLateRecord`, `rescheduledFromSessionId`, `isBlocking`, `deletedAt`, and the cancellation block (`cancellationReason`, `cancelledBy`, `cancellationNotice`, `chargeCancellation`). Index `sessions_patient_id_start_at_idx` on `(patient_id, start_at)` already exists.
- **`evolutions`** has `sessionId` (UNIQUE, nullable) and `finalizedAt` — the join source for the evolution indicator (RF-13.07) and the >30-day read-only hint (RN-13.05).
- **`locations.name`** is the location label (RF-13.05).
- **`cancelledBy`** is the enum `'patient' | 'therapist'` (`src/modules/agenda/lib/cancellation-schema.ts`) — drives the attendance-rate denominator (RN-13.03).
- **Auth gating is already in place:** `classifyPath()` in `src/middleware.ts` maps `/pacientes` to the gated `'app'` class. No new route is added — this is tab content inside an already-gated page.
- **Read-audit pattern exists:** `getEvolutionsByPatientImpl` / `logProntuarioAccessImpl` (`src/modules/medical-records/server/`) show the canonical owner-scoped read + `audit_log` write. `audit_log` has **no** authenticated INSERT policy by design; writes go through direct Drizzle (`db`) as the DB owner, with `user_id` always taken from the verified session.
- **Stack:** RSC page (`src/app/(app)/pacientes/[id]/page.tsx`) renders the client `PatientTabs`; TanStack Query, date-fns + date-fns-tz (`America/Sao_Paulo`), shadcn/ui + Lucide, Zod, Drizzle, Supabase Auth/RLS are all present.

## Goals / Non-Goals

**Goals:**

- Render the session-history tab from a single owner-scoped server read that returns, in one round trip on tab open: the summary strip, the nearest future session, and the first 12 historical sessions (RF-13.02, RNF-13.01).
- Compute the attendance rate and evolution-pending counts in SQL via conditional aggregates + a `LEFT JOIN evolutions` — no per-row round trips.
- Enforce all confidentiality and visibility rules (couples sigilo, soft-delete/blocking exclusion, RLS owner-scope) at the query layer, not the UI.
- Write a `patient.session_history.read` `audit_log` entry on tab open (LGPD-13.01).
- Keep the UI faithful to the Sálvia design system, with correct loading/error/empty states and `prefers-reduced-motion`.
- Cover the change with interleaved unit, integration, and E2E tests — including a negative-auth test.

**Non-Goals (per PRD §3):**

- No new migration, table, column, or index.
- No date-range filter, frequency heatmap, CSV export, inline amount editing, or "schedule extra session" from this tab.
- No partner data for couple sessions — ever.
- No write operations on sessions/evolutions from this tab (CTAs are navigation only).

## Decisions

### D1 — Tab content is a lazily-mounted client component; no new route

The feature is rendered as `sessionsContent` passed into `PatientTabs` (which already takes `overviewContent` / `anamnesisContent`). The sessions tab is a `'use client'` component that fetches its first page **on mount**. Because Radix `TabsContent` mounts only when its tab becomes active (we deliberately do **not** set `forceMount`), the fetch — and therefore the `audit_log` write — fires on actual tab open, matching LGPD-13.01's "abertura da aba" semantics and avoiding an audit entry for users who never open the tab.

*Alternative considered:* fetch server-side in the page RSC and pass `initialData`. Rejected — it would audit on every patient-page load regardless of tab interaction, over-recording sensitive-data access, and would couple the page's TTFB to this query.

*Trade-off:* one client→server round trip before first paint of the tab. Mitigated by the indexed query and the <600ms p95 target (RNF-13.01); the tab shows the 3-card skeleton (RF-13.17) during that round trip.

### D2 — One read entrypoint with cursor-conditional payload

A single Server Action implementation `getPatientSessionHistoryImpl(supabase, input)` in the **`sessions` module** (`server/`, re-exported only from the server-only `server.ts` barrel — never from the client-safe `index.ts`, per the module's documented convention).

- **Initial call** (`cursor` absent): returns `{ summary, futureSession | null, page: Session[12], nextCursor }` **and** writes the audit entry. The summary is the aggregate query; `futureSession` is the single nearest `scheduled|confirmed` with `start_at >= now()`.
- **Load-more call** (`cursor` present): returns `{ page, nextCursor }` only — no summary recompute, no audit, no future session.

This satisfies RF-13.02 (summary computed server-side, no extra round-trips) while keeping "Carregar mais" cheap (RNF-13.02 <400ms).

*Alternative considered:* separate `getSummary` + `getPage` endpoints. Rejected for the initial open (two round trips on the hot path); the cursor-conditional shape keeps a single hot path while still making pagination lightweight.

### D3 — Summary as a single aggregate query

One SQL over the patient's visible sessions (`user_id = :uid AND patient_id = :pid AND deleted_at IS NULL AND is_blocking = false`) using `count(*) filter (where …)`:

- `doneTotal` = `status = 'done'`
- `attendanceDenominator` = `done` + (`cancelled` AND `cancelled_by = 'patient'`) + `no_show` (RN-13.03 — psychologist/`therapist` and NULL `cancelled_by` cancellations are excluded from the denominator)
- `attendanceRate` = `doneTotal / attendanceDenominator` (0 when denominator is 0; explicit `0%` shown, never hidden — edge case §8)
- `doneWithoutEvolution` = `done` rows with no matching `evolutions.session_id` (`LEFT JOIN evolutions e ON e.session_id = s.id`, count where `e.id IS NULL` and `status = 'done'`) — RN-13.04
- `lastDoneAt` = `max(start_at) filter (where status = 'done')`

The percentage rounding and labels happen in a pure helper (unit-tested), not in SQL.

### D4 — List query: descending cursor, future session excluded, couples-safe projection

Historical list = all visible sessions **except** the nearest-future session, ordered `start_at DESC, id DESC`, paginated with the `limit + 1` look-ahead pattern (cursor = `start_at` + `id` of the last row). The future session's `id` is excluded from the list to avoid duplication.

The projection selects only what the card renders, plus `evolutions.id` / `evolutions.finalizedAt` via `LEFT JOIN`. **For couples (`patient_ids` non-null) it selects only the boolean presence** (`patient_ids IS NOT NULL`), never the partner's id, name, or any join to the partner patient (LGPD-13.03 / RN-13.06). Rescheduled tag uses `rescheduled_from_session_id` and the original session's `start_at` (a self-join limited to `start_at` only, owner-scoped).

### D5 — Status filter is hybrid (client ≤50, server >50)

TanStack Query (`useInfiniteQuery`) holds the loaded pages client-side. A pure selector filters the loaded list by the active chip when the total loaded count ≤ 50 (RF-13.11). Above 50, changing the filter resets pagination and refetches with a `status` parameter pushed into the query key, so the server applies the filter (`WHERE status = :status`, or the no-show/cancelled mapping). The nearest-future session is rendered outside the filtered list and **always stays visible** regardless of the active chip (RF-13.10). The 50-threshold decision lives in one client hook so both branches are independently testable.

### D6 — Timezone-correct grouping and formatting

All date display and month/year grouping use `formatInTimeZone(..., 'America/Sao_Paulo', …)` from `date-fns-tz` with the `pt-BR` locale. Grouping keys are computed from the SP-local year+month so the dez→jan boundary (acceptance criterion) is correct regardless of the server's UTC clock. No hand-rolled offset math (see prior incident: SP week-window half-day fudge).

### D7 — Security model (defense in depth)

1. **Middleware** already gates `/pacientes` (`classifyPath` → `'app'`). No classifier change needed.
2. **Server read** authenticates with `supabase.auth.getUser()` (never `getSession()` for authz), validates input with Zod (`patientId` UUID, optional `cursor`, optional `status` enum, `limit` clamped), and **owner-scopes every query** with `eq(sessions.userId, user.id)` — `patientId` from input is a filter, never a trust boundary. Errors return a stable `{ ok: false, code }` shape; no Postgres/stack detail leaks.
3. **RLS** on `sessions`/`evolutions` (`user_id = auth.uid()`) is the last line, covering the cookie-scoped path.
4. **Audit** write goes through direct Drizzle as DB owner (audit_log has no authenticated INSERT policy, by design); `user_id` is the verified session id. The audit write is **best-effort**: a failure is logged (no PII) and does not fail the read — a sensitive-data read must not be blocked by an audit-store hiccup, and the read itself is already owner-scoped.

A **negative-auth** test (anonymous → redirect to `/login`; cross-user → no rows) is part of Definition of Done.

### D8 — Types & validation

Zod schemas are the single source of truth (`z.infer` for types). IDs use the project's branded-type convention where one exists. The result is a discriminated union (`{ ok: true; … } | { ok: false; code }`) so invalid combinations are unrepresentable.

## Risks / Trade-offs

- **[Audit fires on load instead of tab open if `TabsContent` is force-mounted]** → Mitigation: explicitly do not set `forceMount` on the sessions tab; add an integration/E2E assertion that exactly one `audit_log` entry is written per tab open and none on mere page load.
- **[Lazy mount adds a round trip before first paint]** → Mitigation: single indexed query, skeleton during load, <600ms p95 budget; "load more" stays <400ms by skipping summary/audit.
- **[NULL `cancelled_by` on legacy cancelled rows distorts the denominator]** → Decision: only `cancelled_by = 'patient'` counts toward the denominator; NULL/`therapist` are excluded (conservative, matches RN-13.03 intent). Documented and unit-tested.
- **[Couple-session leak via an over-broad projection]** → Mitigation: the list query selects only `patient_ids IS NOT NULL` as a boolean; an integration test asserts the payload for a couple session contains no partner identifier.
- **[Hybrid filter threshold (50) drift between client and server]** → Mitigation: encapsulate the branch in one hook; integration-test both the client-filter path (≤50) and the server-param path (>50) for identical results.
- **[Performance on 300-session patients]** → Mitigation: rely on `sessions_patient_id_start_at_idx`; the aggregate and list both filter on `(patient_id, start_at)`; verify the query plan uses the index (no seq scan) in an integration check.

## Migration Plan

- **No database migration.** Read-only feature over existing tables/index.
- **Deploy:** ship behind the normal PR flow; the change is additive (placeholder → functional tab). The `patient-detail` spec delta records that the `sessions` tab no longer renders "Em breve".
- **Rollback:** revert the PR — `PatientTabs` returns to the "Em breve" placeholder; no data cleanup, no schema change to undo.

## Open Questions

- **RF-13.09 / RF-13.16 — agenda deep-link contract:** "Abrir na agenda" (focus a session) and "Agendar primeira sessão" (open a new-session modal pre-filled with `patient_id`) require `/agenda` to accept query params (e.g. `?focusSession=:id` and `?newSession=1&patientId=:id`). Need to confirm whether the agenda already supports these params or whether a small agenda-side addition is in scope for this change. To resolve during the `specs` artifact.
- **RN-13.05 — "Finalizada" threshold:** the PRD ties the read-only hint to `finalized_at` being set *and* >30 days. Confirm whether the subtle "Finalizada" label should appear whenever `finalized_at` is set, or strictly only after 30 days. Default assumption: label shown whenever `finalized_at` is set; ">30 days" is descriptive of the typical case.
- **Couple-session attendance accounting:** confirm a couple session counts once (by `id`) in the summary, not once per `patient_ids` entry — assumed yes (rows are counted, not patients).
