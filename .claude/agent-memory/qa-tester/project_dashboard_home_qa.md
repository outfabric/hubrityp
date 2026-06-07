---
name: dashboard-home-qa
description: How the operational /dashboard renders and how to QA it — empty-state-vs-four-sections branch, SP-timezone "today" window, post-MVP string exclusion, mobile chevron collapse, testids
metadata:
  type: project
---

Operational home for the authenticated psychologist at `/dashboard`. Module: `src/modules/dashboard` (server reads in `server/`, presentational components in `components/`, SP-timezone window helpers in `lib/sao-paulo-windows.ts`). Page: `src/app/(app)/dashboard/page.tsx`.

**Key branch to know before QA (this trips up scenario coverage):**
- The page calls `hasAnyData(supabase)` = "≥1 patient OR ≥1 session for this owner". If FALSE → it renders ONLY `FirstStepsSlot` ("Comece por aqui", two CTAs to `/pacientes` + `/agenda`); the four sections are NOT in the DOM. If TRUE → the four sections render: Hoje, Pendências, Resumo da semana, Ações rápidas (in that order). So to QA the four sections / weekly empty-states / mobile collapse you MUST seed ≥1 patient or session; to QA the empty state use a zero-data account. Use TWO accounts.
- Seeding (direct SQL, NOT psql heredoc with `\set` — that silently no-ops here): `INSERT INTO public.patients (id,user_id,full_name,consent_signed_at) VALUES (...)` then `INSERT INTO public.sessions (user_id,patient_id,start_at,end_at,duration_minutes,modality,status) VALUES (...)`. `sessions.modality ∈ {in_person, online}` (CHECK), `status ∈ {scheduled,confirmed,done,cancelled,no_show}`.

**"Today" / "this week" use America/Sao_Paulo wall-clock (UTC-3), not server UTC.** `getTodaySessions` bounds rows to the SP calendar day; "next" = first session with `start_at >= now`. When seeding a session that must appear "today" and be the upcoming "next", pick a `start_at` (UTC) that is still inside the SP day AND in the future — near SP midnight the today-window is short, so prefer seeding one past (`done`) + one near-future session.

**Section behaviours (no bugs as of 2026-06-03, all scenarios PASS):**
- Pendências: only 3 MVP rows (overdue evolutions / patients missing consent / AI notes to review); all-zero → "Tudo em dia." (`dashboard-pendencias-clear`). Post-MVP types never queried.
- Resumo da semana: a count metric of 0 renders graceful empty copy "Ainda sem dados suficientes — agende sua primeira sessão para começar." — NEVER a bare "0". No-show rate is `null` below sample threshold → same empty copy.
- Ações rápidas: "Novo paciente"/"Nova sessão" are `<button>` (router.push to `/pacientes?novo=1` / `/agenda?novo=1`; the patients page rewrites to `?status=active`). "Ver agenda completa"→`/agenda`, "Ver pacientes"→`/pacientes`. "Abrir sessão" (Hoje) online→`/sessao/<id>/video`, in_person→`/pacientes/<id>` (server-computed, no IDOR surface).
- **Post-MVP strings "Receita Saúde"/"cobrança"/"WhatsApp" must be ABSENT** from the dashboard main+body (spec). Verified absent.

**Responsive (`DashboardSecondary` client wrapper):** Hoje + Pendências always visible. Resumo + Ações collapse behind a single chevron `dashboard-secondary-toggle` (label "Resumo e ações", `aria-expanded`) ONLY on mobile; at `md` (≥768px) the toggle is `md:hidden` and both sections always show. At 375px the 1px `scrollWidth>clientWidth` is a document-root rounding artifact (no `main` element overflows) — not a real horizontal-scroll bug.

Testids: `dashboard-greeting`, `dashboard-first-steps`(`-intro`/`-new-patient`/`-new-session`), `dashboard-section-today`/`-pendencias`/`-weekly`(`-skeleton`)/`-actions`, `dashboard-today-next`/`-empty`/`-open-session`/`-list`/`-list-item`/`-status-<status>`, `dashboard-pendencias-clear`/`-list`/`-row-<key>`/`-link-<key>`, `dashboard-weekly-<key>`(`-value`/`-empty`), `dashboard-actions-new-patient`/`-new-session`/`-agenda`/`-patients`, `dashboard-secondary`/`-toggle`/`-content`.

A11y: single `<h1>` "Painel"; section titles are shadcn `CardTitle` = `<div>` (no h2/h3) — app-wide convention, LOW finding only. Focus uses `focus-visible:shadow-focus` (only on keyboard focus, not programmatic `.focus()`). See [[authenticated-browser-qa-setup]] for account creation; bash `UID` is readonly — use another var name when capturing user_id.
