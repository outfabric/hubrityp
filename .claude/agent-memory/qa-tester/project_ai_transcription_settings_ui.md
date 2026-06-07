---
name: ai-transcription-settings-ui
description: AI transcription settings page at /configuracoes/transcricao-ia — layout, save/disable flows, testids, QA-1 findings
metadata:
  type: project
---

Settings page at `/configuracoes/transcricao-ia` (route group `(app)`, gated as `/configuracoes/*`). Server Component reads settings + stats in parallel; settings read does a lazy UPSERT (`onConflictDoNothing` on `user_id`) so first visit creates a defaults row: `enabled=false, default_template='livre', keep_audio_hours=24, keep_transcription=false, risk_detection_sensitivity='medium'`. Table `public.ai_transcription_settings` has CHECK constraints (template enum, sensitivity low/medium/high, keep_audio_hours 24–168) + RLS owner policies.

Form (client, react-hook-form + zod). Key testids: `transcription-settings-form`, `-enabled` (switch), `-template` (select), `-sensitivity` (radiogroup), `-retention` (select, **disabled**, MVP-locked to 24h), `-keep-transcription` (switch), `-save` (button). Disable guard: when `initial.enabled` is true and user toggles off + Salvar, an AlertDialog (`transcription-disable-dialog`, confirm `-confirm` / cancel `-cancel`) gates the action — it runs ONLY on confirm. Save shows toast "Configurações salvas" + `router.refresh()`. Stats panel: `transcription-stats-empty` (single card, Sparkles, "Nenhuma transcrição processada ainda") when `totalProcessed=0`, else `transcription-stats-grid` (4 StatCards). Settings index card testid `settings-area-card-transcricao-ia` (Sparkles icon).

**QA-1 result (all 8 spec scenarios PASS, no CRIT/HIGH/MED).** LOW items: (1) empty-state heading skips h1→h4; (2) on disable-dialog Cancel the switch stays visually OFF while persisted state is still ON (form dirty, no revert). Double-submit is safe (`useTransition` + `disabled={isPending}`, "Salvando..." within ~50ms; only 1 write/toast).

**Correction to [[app-mobile-sidebar-overflow]]:** on this page at 375px there is NO horizontal overflow (scrollWidth=375) — the app shell collapses nav behind a hamburger here. The blanket "overflow on all authenticated pages" memory is stale for at least the configuracoes routes; verify per-page rather than assuming.

**How to apply:** To test scenario 4 you must first persist `enabled=true` (toggle + save) and reload so `initial.enabled` is true, otherwise the disable guard never fires. To create a test user fast, see [[local-env-setup-notes]] — but note the `handle_new_user` trigger requires user_metadata (fullName, crpNumber, crpUf, termsAcceptedAt, privacyAcceptedAt, sensitiveDataConsentAt); GoTrue admin API (`POST /auth/v1/admin/users` with service_role key from worktree `.env.local`) + `UPDATE profiles SET status='active'` is the quickest path. Local console always shows 6 noise errors (CSP docker hostnames, dev eval, favicon 404) — ignore them.
