## Context

Change 1 (`telepsicologia-data-model-and-tokens`) provides the `video_rooms` table, Stream client singleton, `createVideoRoom` and `getVideoToken` Server Actions, and the patient token/JWT infrastructure. This change builds the psychologist's authenticated video call page and the core call UI components.

The existing `sessions` table has all needed fields (`modality`, `status`, `start_at`, `end_at`, `patient_id`). The agenda module already renders session cards with action buttons — this change adds an "Iniciar video" link for online sessions.

Stream React SDK (`@stream-io/video-react-sdk`) provides pre-built components: `StreamVideo` (client provider), `StreamCall` (call provider), `SpeakerLayout` (video grid), `CallControls`, plus hooks like `useCallCallingState`, `useCallStateHooks`, `useCall`. The SDK requires its CSS to be imported.

## Goals / Non-Goals

**Goals:**

- Authenticated route `/sessao/[id]/video` gated by middleware (`/sessao` in APP_PREFIXES)
- Pre-call lobby with camera/mic preview and permission handling
- In-call layout following Salvia Design System (calmo, funcional, sem gradientes)
- Waiting room indicator when patient is in the lobby + "Admitir" button
- Call controls: mic, camera, screen share, chat toggle, end call
- End call flow with confirmation modal, session status update, evolution prompt
- Connection quality indicator (green/yellow/red)
- Elapsed time display
- Server Actions for admitting patient and ending session
- Negative-auth integration test (anonymous request to `/sessao/[id]/video` redirects to login)

**Non-Goals:**

- Patient-facing UI (change 3)
- In-call chat panel rendering (change 4 — this change adds the toggle button but not the chat drawer)
- Prontuario sidebar drawer during call (change 4)
- Recording controls (change 5)
- Auto-room-creation when session is created/updated (change 5)
- Extend session / add 15 min (change 5)

## Decisions

**1. Route structure: `/sessao/[id]/video` inside `(app)` group**

The page lives at `src/app/(app)/sessao/[id]/video/page.tsx`. The `[id]` param is the `sessions.id` UUID (not the video_rooms.id). The Server Component loads the session + video room data, verifies ownership, and passes tokens to the client component.

Why `/sessao/[id]/video` and not `/dashboard/sessao/...`: the PRD says "app/sessao/:id/video" (RF-09.04). We keep `/sessao` as a top-level app prefix (not nested under `/dashboard`) for cleaner URLs. This requires adding `/sessao` to the middleware's `APP_PREFIXES`.

**2. Middleware gating: add `/sessao` to APP_PREFIXES**

In `src/middleware.ts:classifyPath()`, add `'/sessao'` to the `APP_PREFIXES` array. This gates all `/sessao/*` routes behind the full auth decision table. The negative-auth test (anonymous request -> redirect to /login) is mandatory for this change.

**3. Page architecture: Server Component -> Client Component boundary**

```
page.tsx (Server Component)
  ├── loads session + video_room via Drizzle (RLS-scoped)
  ├── calls getVideoToken() to mint psychologist JWT
  ├── passes { streamCallId, token, apiKey, session, patient } to:
  └── <VideoCallClient /> ('use client')
        ├── initializes StreamVideoClient with apiKey + token + userId
        ├── creates call instance: client.call('default', streamCallId)
        ├── wraps with <StreamVideo client={client}>
        │     <StreamCall call={call}>
        │       <VideoCallLayout />
        │     </StreamCall>
        │   </StreamVideo>
        └── VideoCallLayout switches on CallingState:
              ├── IDLE/JOINING -> <PreCallLobby />
              ├── JOINED -> <InCallView />
              └── LEFT -> <PostCallView />
```

The `page.tsx` Server Component is responsible for all auth checks and data loading. The `'use client'` boundary is at `VideoCallClient` — the Stream SDK requires client-side hooks. `import 'server-only'` in any file that touches the Stream Node SDK.

**4. Pre-call lobby: device check + permissions**

Before joining, the psychologist sees:
- Camera preview (local video feed)
- Mic level indicator
- Device selector (if multiple cameras/mics)
- "Entrar na sessao" primary button
- Patient waiting indicator (if patient is already in the call's lobby)

Uses Stream SDK's `call.camera.enable()` / `call.microphone.enable()` before `call.join()`. If browser denies permissions, show an inline error with instructions (not a tooltip — Salvia prohibition).

**5. In-call layout: Salvia-compliant**

- Background: `surface` (not black — calmo before bonito)
- Patient video: large area, takes ~75% of viewport height
- Psychologist video: small PiP in bottom-right, `radius-xl`, `shadow-md`
- Controls bar: bottom-center, bg `surface-muted`, `radius-2xl`, `shadow-sm`, `padding space-3`
- Buttons: `ghost` variant icons (mic, camera, screen), `danger` variant for "Encerrar"
- Elapsed time: top-left, `caption` style, `text-tertiary`
- Connection quality: top-right, 3-bar icon (Lucide `Signal`/`SignalLow`/`SignalZero`), color-coded (success-500/warning-500/danger-500)
- Waiting room badge: top-center, `info-50` bg + `info-700` text, "Paciente aguardando" + "Admitir" button (primary sm)

Mobile: controls bar stays bottom, PiP shrinks, layout goes single-column.

**6. End call flow**

1. Psychologist clicks "Encerrar" (danger button)
2. Confirmation modal (shadcn AlertDialog): "Encerrar sessao?" / "O paciente sera desconectado." / [Cancelar] [Encerrar sessao]
3. On confirm: Server Action `endVideoSession`:
   - `supabase.auth.getUser()` to authenticate
   - Verify room ownership
   - Call `streamClient.video.call('default', streamCallId).end()` to end the Stream call
   - UPDATE `video_rooms` SET status='ended'
   - UPDATE `sessions` SET status='done'
   - INSERT `video_session_logs` event_type='room_ended'
4. After action returns: show post-call modal "Registrar evolucao agora?" with link to `/pacientes/[patientId]/prontuario/evolucoes`

**7. Agenda integration: "Iniciar video" button**

In the session card/detail within the agenda module, for sessions where `modality='online'` AND `status IN ('scheduled', 'confirmed')`:
- Show a `Button` variant `secondary` with `Video` icon (Lucide) and text "Iniciar video"
- Links to `/sessao/[sessionId]/video`
- If `video_rooms` row does not exist yet, the button triggers `createVideoRoom` first (from change 1), then navigates

## Frontend — Design System Salvia

### Pre-call lobby

- Card `default` centered in viewport, max-width 640px
- Camera preview: 16:9 aspect ratio, `radius-xl`, `border border-strong`
- Mic level: horizontal bar, `brand-500` fill, `surface-muted` track
- Device selectors: shadcn `Select`, `body-sm`
- "Entrar na sessao" `Button primary lg`, full-width on mobile
- Patient waiting badge: `Badge info` with `body-sm` text

### In-call view

- Full viewport height (`h-[calc(100vh-64px)]` accounting for app header, or full-screen if header hidden)
- Controls: gap `space-2` between buttons, `Button ghost` with Lucide icons 20px
- End call: `Button danger` with `PhoneOff` icon
- No gradients, no glow, no blur — flat surfaces only

### Post-call prompt

- shadcn `AlertDialog` — title "Sessao encerrada", description "Deseja registrar a evolucao agora?", actions: "Registrar evolucao" (primary, links to prontuario), "Depois" (secondary, closes and returns to agenda)

### Accessibility

- All controls: `aria-label` in PT-BR ("Ligar/desligar microfone", "Ligar/desligar camera", etc.)
- Focus management: after joining call, focus moves to video area; after ending, focus moves to post-call dialog
- Keyboard navigation: Tab through controls, Enter/Space to toggle
- `prefers-reduced-motion`: disable any transition on video layout changes

## Risks / Trade-offs

- [Risk: Stream React SDK CSS conflicts with Tailwind/Salvia tokens] → Mitigation: import Stream CSS in the `VideoCallClient` component only (scoped), override conflicting styles with Tailwind classes using `!important` sparingly. Consider wrapping Stream components in a container with `isolate` CSS.
- [Risk: first-load performance of Stream SDK bundle] → Mitigation: the video page is dynamically imported (`next/dynamic` with `ssr: false`) so the SDK is not included in the initial bundle of other pages.
- [Risk: psychologist navigates away mid-call] → Mitigation: `beforeunload` event handler warns "Voce esta em uma sessao ativa". Stream SDK handles graceful disconnect.
- [Trade-off: full-viewport video vs. app shell header] → In-call mode hides the sidebar nav and shows a minimal header (back arrow + session info). The full app shell is restored after ending.

## Migration Plan

No database migration. This change adds routes and UI components only (beyond the Server Actions for admit/end which write to tables created in change 1).

Deploy steps:
1. Update middleware (add `/sessao` prefix)
2. Deploy new route + components
3. Negative-auth test must pass before merge

Rollback: revert the route and middleware change. No persistent state affected.

## Open Questions

None blocking. Future consideration: whether the video call page should completely replace the app shell (full-screen mode) or remain within it. Starting with "within app shell, minimal header" and can evolve based on user feedback.
