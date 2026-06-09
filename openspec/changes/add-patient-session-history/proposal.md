## Why

The "Histórico de sessões" tab on the patient detail page (`/pacientes/:id`) is currently an "Em breve" placeholder. To see a patient's session history today, the psychologist must scan the agenda week-by-week and open each block individually — slow, error-prone, and impractical for sessions from months ago. There is no consolidated view answering the everyday clinical questions: how many sessions have we had, has the patient been missing them, which done sessions still lack an evolution record, and when was the last session. This change turns that placeholder into a read-oriented clinical-operational view that bridges "session scheduled" and "evolution recorded" without leaving the patient file (PRD 13).

## What Changes

- Replace the "Em breve" placeholder of the `sessions` tab in `PatientTabs` with a functional **patient session history** view.
- Add an owner-scoped server read that returns, for one patient: a **summary strip** (total `done`, attendance rate, count of `done` sessions missing an evolution, date of last `done` session) computed by an aggregate query, plus a **paginated chronological list** (12 per page, descending) of historical sessions and **at most one** future session (the nearest `scheduled`/`confirmed`).
- Render each session as an `interactive` Sálvia card with status-coded icon/badge/label, date/time/duration, modality, location, amount, couple/rescheduled/late-record tags, and an **evolution indicator** with CTAs: "Registrar" (→ `/pacientes/:id/prontuario/evolucoes/nova?sessionId=…`) for `done`-without-evolution, "Ver" (→ `/pacientes/:id/prontuario/evolucoes/:evolutionId`) when linked.
- Add **client-side status filter** chips (Todas / Realizadas / Canceladas / Não compareceu), with a server-parameterized fallback when more than 50 sessions are loaded; "Carregar mais" pagination; month/year group dividers; empty/loading/error states.
- Write an **`audit_log` read entry** (`patient_id` + `user_id`) when the tab loads, matching the prontuário read-audit pattern (LGPD-13.01).
- Enforce **individual confidentiality** for couples sessions: show only a "Sessão de casal" tag, never the partner's identity (LGPD-13.03 / RN-02.07).
- No database migration: reuse `sessions`, `evolutions`, `locations` and the existing `sessions_patient_id_start_at_idx` index.

## Capabilities

### New Capabilities

- `patient-session-history`: Owner-scoped, RLS-protected server reads (summary aggregate + paginated session list with a single nearest-future session and evolution-link join), the read-audit entry on tab open, couples-session confidentiality enforcement, and the Sálvia-styled tab UI (status-coded cards, filter chips, pagination, month dividers, evolution CTAs, empty/loading/error states).

### Modified Capabilities

- `patient-detail`: The "Histórico de sessões tab remains a placeholder" requirement changes — the `sessions` tab no longer renders the "Em breve" placeholder; it renders the session-history view. The tab order, labels, and the other tabs are unchanged.

## Impact

- **Code (frontend):** `src/modules/patients/components/patient-tabs.tsx` (wire `sessions` tab content); new `src/modules/patients/` (or `src/modules/sessions/`) components for the history view, summary strip, session card, filter chips, and states; patient detail page wiring to pass the tab content.
- **Code (backend):** new owner-scoped read helpers (summary aggregate + paginated list) in the sessions/patients module server layer, validated with Zod and authorized via `supabase.auth.getUser()` + RLS (`user_id = auth.uid()`); audit-log write reusing the existing audit module.
- **Data:** read-only against `sessions`, `evolutions`, `locations`; `audit_log` insert on read. No migration; relies on `sessions_patient_id_start_at_idx`.
- **Specs:** new `patient-session-history` spec; delta to `patient-detail`.
- **Tests:** unit (date grouping, attendance-rate formula, status mapping, Zod schemas), integration (RLS isolation, aggregate correctness, pagination, evolution join, audit write, soft-deleted/blocking exclusion), E2E seeded (tab renders, filter, load-more, evolution CTAs, empty state, negative-auth).
- **Dependencies/SDKs:** Next.js App Router (RSC), TanStack Query (load-more), date-fns (`pt-BR`/`America/Sao_Paulo`), shadcn/ui + Lucide, Zod, Drizzle, Supabase Auth/RLS. No data leaves Brazil.
