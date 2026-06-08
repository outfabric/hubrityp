# Memory index

- [E2E shared-seed session slot collision](feedback_e2e_shared_seed_session_slot_collision.md) — two seeded specs scheduling SAME seed patient at SAME tomorrow slot race detectConflicts under fullyParallel; loser → conflict_warning, modal stays open, toBeHidden fails
- [E2E build Supabase URL must be local](feedback_e2e_build_supabase_url_must_be_local.md) — e2e build MUST set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321; wrong value bakes wrong URL into edge middleware → EVERY authenticated spec redirects to /login (looks like auth regression, is build-env mistake)
- [NPS modal overlay blocks feedback card](feedback_nps_modal_overlay_blocks_feedback_card.md) — day-7 NPS modal renders on every (app) route incl /configuracoes/feedback; eligible user → dup testids + Radix overlay intercepts card clicks
- [E2E dashboard networkidle flake](feedback_e2e_dashboard_networkidle_flake.md) — whatsapp-health-banner.spec "navigates to reconnect" times out at page.goto('/dashboard',{waitUntil:'networkidle'}); dashboard keeps net busy, page renders fine; pre-existing flake not a copy regression

- [Wizard spec pollutes seed full_name](project_wizard_spec_pollutes_seed_fullname.md) — wizard-flow.spec.ts leaves seed full_name='Seed Baseline'; auth/agenda-confirm/telepsicologia fail nondeterministically (pre-existing PR#71 bug)
- [E2E prontuario tabs flaky](feedback_e2e_prontuario_tabs_flaky.md) — prontuario tab-content toBeVisible flakes under parallel load + 0 retries; validate with CI=true
- [OAuth stub clear wipes dedicated users](feedback_oauth_stub_clear_wipes_dedicated_users.md) — unscoped clear-oauth-users wiped parallel checklist/tour/empty dedicated users mid-test → /login; scope the clear by code
- [E2E seeded port conflicts](feedback_e2e_seeded_ports_conflict.md) — e2e:seeded needs :3000 (dev container) and :54321 (supabase CLI) free; stop both before running
- [E2E seeded needs fresh build](feedback_e2e_seeded_needs_fresh_build.md) — e2e:seeded runs next start on prebuilt .next; rebuild after app/component changes or it silently tests old code
- [Client runtime import from server barrel](project_client_runtime_import_from_server_barrel.md) — 'use client' importing a runtime VALUE (Zod schema, or clientEnv from @/shared/env) from a server-only barrel breaks next build; import value from the leaf (@/shared/env/client)
- [Default-off flag breaks full-view UI suites](project_default_off_flag_breaks_full_view_ui_suites.md) — a default-OFF UI feature flag freezes cards and breaks pre-existing RTL suites asserting closest('a').href; force flag ON via vi.stubEnv + dynamic import
- [E2E seeded build env block](feedback_e2e_seeded_build_env_block.md) — e2e:seeded build needs the FULL CI env block; missing any var aborts page-data collection ("Compiled successfully" is not enough)
- [use client env import from leaf](feedback_use_client_env_import_from_leaf.md) — 'use client' must import clientEnv from @/shared/env/client, never the @/shared/env barrel (server-only); barrel import breaks next build + blocks e2e:seeded
- [sensitive-data consent nullable](project_sensitive_data_consent_nullable.md) — profiles.sensitive_data_consent_at relaxed to nullable (mig 0037) for onboarding step-3 gate; NULL = block clinical ingestion; signup still stamps it
- [Testcontainers reuse dirty state](feedback_testcontainers_reuse_dirty_state.md) — integration container .withReuse() no teardown; stale rows cause spurious FK/count fails; docker rm -f for clean slate before trusting a failure
- [SP week-window half-day fudge](feedback_sp_week_window_half_day_fudge.md) — subtracting (N days + MS/2) to find SP Monday overshoots to Sunday; use a noon-anchored day-shift primitive then snap
- [Integration cleanup use cleanTestData](feedback_integration_cleanup_use_cleantestdata.md) — hand-rolled DELETE FROM sessions in afterEach trips video_rooms FK on the reused DB; use shared cleanTestData() (FK-ordered) + beforeAll wipe
- [E2E action binding race (ssr:false)](feedback_e2e_action_binding_race_ssr_false.md) — clicking a dynamic(ssr:false) leaf control that fires a fire-and-forget Server Action too early posts a no-op (no impl run, 200); settle ~1.5s + waitForResponse before asserting the DB write
- [E2E dedicated-user refresh token](feedback_e2e_dedicated_user_refresh_token.md) — runtime-registered dedicated e2e users need a UNIQUE refresh token + a mock refresh_token grant, else a Server Action's server-side getUser resolves the wrong user; use signInAsDedicatedUser helper
- [Tour overlay blocks shared-seed specs](feedback_tour_overlay_blocks_shared_seed_specs.md) — default-ON dashboard overlay gated by NULL profile col auto-runs for shared seed user, intercepts clicks across every /dashboard spec; stamp the col done in global-setup for all non-overlay users
- [today-sessions int SP-midnight flake](feedback_today_sessions_int_sp_midnight_flake.md) — dashboard today-sessions.int.test.ts "all past" case fails when run in first ~2h after São Paulo midnight (seeds "2h ago" → previous SP day); date-deterministic, not load flakiness

Notes:
