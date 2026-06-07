---
name: copy-patient-video-link-qa
description: Copy-patient-video-link feature — APP_URL gates the whole feature (unset in docker-compose), drawer status gating, toast branch accents, testids
metadata:
  type: project
---

QA of the "Copiar link do paciente" feature (online session video link sharing).

**APP_URL gates the entire feature.** `createSessionImpl` only returns `patientVideoUrl` when `serverEnv.APP_URL` is truthy (`create-session.ts:230-237`). `APP_URL` is `z.string().url().optional()`. As of the iteration-1 fix (commit 7f12098, "fix: add APP_URL to docker-compose and clipboard error handling") **`APP_URL: http://localhost:3000` IS now in `docker-compose.yml` (line 45)** — so on a fresh local stack the feature works out of the box. Re-verified working 2026-06-06 (qa-2): online sessions get a toast "Copiar link" action and a drawer "Link do paciente" section. **Why this was a MÉDIO before:** it used to be absent from docker-compose → silent degradation with zero error signal. **How to apply:** if the feature looks inert, confirm APP_URL is still in docker-compose AND the app container was (re)started after the var was added (Next reads it at server start; it does NOT appear in container `printenv`). The room is reserved in `video_rooms` regardless (pure DB work, no Stream dep — `reserve-video-room.ts`), so a missing APP_URL hides the UI but the token still exists.

**Toast branch tell:** the WITH-link branch uses accented "Sessão agendada com sucesso." + description "Link do paciente disponível para cópia." + "Copiar link" action; the no-link/else branch uses plain "Sessao agendada com sucesso." (no accent, no action). The accent on the title is a quick visual signal of which branch fired.

**Drawer status gating:** "Link do paciente" section renders only for `modality==='online'` AND status `scheduled|confirmed` AND `patientVideoUrl` present (`session-detail-drawer.tsx:572-580`). Hidden for cancelled/done and for presencial. Verified in browser.

**Testids:** `patient-video-link-section`, `copy-patient-link-button`. Copy button toggles Copiado!/Check ↔ Copiar link/Copy over ~2s; drawer copy has a `.catch()` + error toast. As of iteration-1 fix (commit 7f12098) the MODAL toast action ALSO has a `.catch(() => toast.error('Nao foi possivel copiar o link. Tente novamente.'))` (`session-form-modal.tsx:650-651`) — the earlier LOW resilience gap is FIXED. Drawer error path verified live (mock writeText reject → error toast, label stays "Copiar link", no false "Copiado!"); modal-toast error path is code-identical but hard to live-click (sonner success toast auto-dismisses before a deliberate failing click lands). Token is random 64-hex, never in browser URL or console (LGPD clean); the long URL is truncated in the drawer via overflow:hidden+ellipsis+nowrap (no overflow at 375px). Shareable `/v/<token>` page returns 200.

See [[authenticated-browser-qa-setup]] and [[playwright-cli-invocation]] for the cookie-injection auth workaround (storage key `sb-supabase_kong_hubrityp-auth-token`, value built with @supabase/ssr `createServerClient.setSession` inside the app container, then `playwright-cli cookie-set ... --domain=localhost`).
