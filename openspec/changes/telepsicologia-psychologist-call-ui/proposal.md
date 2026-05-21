## Why

With the data model and token infrastructure in place (change 1), the psychologist needs an authenticated page to join and manage video sessions. This change builds the in-app video call page at `/sessao/[id]/video` where the psychologist initiates calls, sees the waiting room status, admits patients, and controls audio/video/screen sharing. The page must be gated by auth middleware, use the Stream React SDK for the call UI, and integrate with the existing agenda navigation (RF-09.09).

## What Changes

- New authenticated route `src/app/(app)/sessao/[id]/video/page.tsx` — the psychologist's video call page
- Middleware update: add `/sessao` prefix to `classifyPath()` APP_PREFIXES so the route is gated as `'app'`
- Pre-call lobby component with device check (camera/mic preview, permission request)
- In-call layout: patient video (large), psychologist video (small PiP), controls bar (mic, camera, screen share, chat toggle, end call), elapsed time indicator, connection quality indicator
- Waiting room indicator: "Paciente aguardando" notification when patient is in the lobby, with "Admitir" button (RF-09.08)
- End call flow: confirmation modal, mark session as `done`, disconnect patient with notice, prompt "Registrar evolucao agora?" (RF-09.11)
- Server Action `admitPatient` — updates room status to 'active' and signals the patient via Stream call state
- Server Action `endVideoSession` — ends the Stream call, updates video_rooms.status to 'ended', marks session as 'done', logs event
- Connection quality indicator component (green/yellow/red bar per RF-09.17)
- Elapsed time display component

## Capabilities

### New Capabilities

- `telepsicologia-psychologist-ui`: Authenticated video call page for the psychologist with lobby, in-call layout, controls, waiting room management, end-call flow
- `telepsicologia-call-controls`: Reusable call control components (mic toggle, camera toggle, screen share, end call) using Stream React SDK hooks

### Modified Capabilities

- `middleware-gating`: Add `/sessao` prefix to `classifyPath()` APP_PREFIXES
- `agenda-sessions`: "Iniciar video" action button in agenda session cards for online sessions (links to `/sessao/[id]/video`)

## Impact

- **Routes:** New `src/app/(app)/sessao/[id]/video/page.tsx` (authenticated)
- **Middleware:** `classifyPath()` gains `/sessao` prefix
- **Module expansion:** `src/modules/telepsicologia/components/` gains call UI components
- **Server Actions:** `admitPatient`, `endVideoSession` in `src/modules/telepsicologia/server/`
- **Dependencies:** `@stream-io/video-react-sdk` (already installed in change 1) — CSS import + StreamVideo/StreamCall providers
- **Security:** Route gated via middleware + layout session check + Server Action auth + RLS. Psychologist can only join calls for their own sessions. Stream token is admin-scoped to the specific call
