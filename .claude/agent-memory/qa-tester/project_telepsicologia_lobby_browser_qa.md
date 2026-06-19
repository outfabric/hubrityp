---
name: telepsicologia-lobby-browser-qa
description: How to reach the telepsicologia pre-call lobby live in the browser on local Docker (E2E_STREAM_STUB bypass) and what is/isn't browser-verifiable for the video session room
metadata:
  type: project
---

The telepsicologia **pre-call lobby** CAN be browser-QA'd locally, but only with a bypass. The **in-call surfaces cannot**.

**Why the lobby is normally unreachable locally:** route `/sessao/[id]/video` (page.tsx) mints a Stream token via `getVideoToken()` → `streamClient.upsertUsers()`, a real Stream REST call. Local dummy creds (`dummy_stream_key_for_local_dev`) make it reject → `error: 'unknown'` → page short-circuits to a "Sala indisponível" card. The lobby never renders. Server log shows `get_video_token_failed errorCode:2`.

**How to reach the live lobby (verified 2026-06-08):**
1. Set `E2E_STREAM_STUB=true` (server env; documented bypass in `src/modules/telepsicologia/server/stream-client.ts` → `getStreamClient()` returns a stub: `upsertUsers` no-ops, `generateCallToken` → `'e2e-stub-call-token'`). Inject via an untracked `docker-compose.override.yml` (`services: app: environment: E2E_STREAM_STUB: 'true'`), then `docker compose up -d app`. Clean it up afterward (rm override + `up -d app`) so the worktree stays clean.
2. Seed an `online` session owned by the active psychologist + a `video_rooms` row with **non-null `stream_call_id`** and status `pending`/`active` (else you get the CreateRoomCard reservation UI, not the lobby). video_rooms requires NOT-NULL `patient_token` (unique), `available_from`, `expires_at`. status CHECK ∈ {pending,active,ended,expired}.
3. Navigate; the lobby ("Preparar para sessão" card) renders even with no camera/mic — the headless QA browser has no devices, so the lobby's mount-time `enableDevices()` rejects and shows the PT-BR permission alert (this IS scenario-9 coverage, for free).

**What's browser-verifiable on the live lobby:** mic/camera = shared `DeviceToggleButton` (Lucide `lucide-mic-off`/`lucide-video-off` SVG class, `h-5 w-5`, off-variant), PT-BR aria-labels (`Ligar microfone`/`Ligar câmera`), `type=button`, visible `focus-visible:shadow-focus` ring (`rgba(107,138,102,0.2) 0 0 0 3px`), permission-denied PT-BR alert, responsive 375/1280, LGPD (no patient name/CPF/token in DOM or URL — URL has only the session UUID).

**What's NOT browser-verifiable locally:** the in-call control bar (CallControlBar), chat drawer, and patient bar only mount in `CallingState.JOINED`, which needs a live Stream WebSocket. The server stub does NOT give the browser SDK a working connection — clicking "Entrar na sessão" fails (`call.join` rejects, `userToken does not have a user_id` warning) and stays on the lobby. So chat drawer layout/typography (insets, `bg-surface border-t border-border` footer, caption/body-sm tokens), de-dup, and patient-bar "no screen share" are covered by the **passing component unit tests** under `src/__tests__/unit/modules/telepsicologia/components/` (chat-layout, chat-drawer, call-control-bar, patient-call-controls, device-toggle-button, pre-call-lobby — ~60 tests).

**e2e caveat:** the seeded spec `e2e/seeded/telepsicologia/patient-join-flow.spec.ts` (`@telepsicologia psychologist in-call surface`) exercises the lobby controls in a real browser with Stream routes mocked + permissions granted + `E2E_STREAM_STUB`. It will NOT run from inside the app container (global-setup needs host networking → `ECONNREFUSED 127.0.0.1:32768`); run it from the host / CI.

This supersedes the blanket "[[telepsicologia-video-qa-blocked]]" claim for the LOBBY specifically. Related: [[authenticated-browser-qa-setup]], [[playwright-cli-invocation]].
