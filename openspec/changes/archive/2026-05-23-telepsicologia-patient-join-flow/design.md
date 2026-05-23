## Context

Changes 1 and 2 provide the `video_rooms` table (with `patient_token` and `patient_jwt`), the Stream client, and the psychologist's call UI. The patient join flow is the mirror: a public page that uses the stored token to look up the room, validate the time window, and connect the patient to the Stream call — all without a Supabase session.

The existing codebase has two public token-gated routes: `/confirmar-sessao/[token]` and `/termo/[token]`. Both use a Route Handler or Server Component with service-role Supabase to look up the token. This change follows the same pattern.

Stream's React SDK works with anonymous/guest users — the patient initializes a `StreamVideoClient` with the pre-minted JWT (which embeds the synthetic `patient-<uuid>` user ID and call scope). No Stream account creation is needed for the patient.

## Goals / Non-Goals

**Goals:**

- Public route `/v/[token]` that renders without a Supabase session
- Route Handler to validate token and return Stream JWT + session metadata
- Time-gate: show "come back later" before `available_from`
- Waiting room: patient sees lobby until psychologist admits
- In-call: clean patient UI with mic/camera/leave controls
- Post-call: "session ended" message
- Browser compatibility check
- Device permission handling with troubleshooting
- Video session log entries for patient events (join/leave/connection_drop)
- Couple session support: partner uses `partner_token` at `/v/[partnerToken]`
- Integration tests for token validation (valid, expired, invalid, too early)
- E2E test for patient join golden path (mock Stream)

**Non-Goals:**

- Patient screen sharing (RF-09.14 — only psychologist)
- Chat from patient side (change 4)
- Recording banner display (change 5)
- Patient self-registration or account creation
- Any persistent patient state beyond `video_session_logs`

## Decisions

**1. Route: `/v/[token]` as a public path**

Short URL for WhatsApp message brevity. `classifyPath()` already defaults to `'public'` for unrecognized prefixes, but we explicitly add `/v` as a `'public'` classification with a comment (defense against future default-deny refactor, same pattern as `/escala`).

The `[token]` is the 64-char hex `patient_token` stored in `video_rooms`. The Server Component calls the Route Handler to validate and get the JWT.

**2. Route Handler `POST /api/video/join` for token validation**

Why a Route Handler instead of a Server Action: the patient page has no Supabase session, so Server Actions (which rely on the cookie-based Supabase client) would fail. A Route Handler with service-role is the correct pattern for public, token-gated operations.

Request body: `{ token: string }` (Zod-validated).
Response (200): `{ streamToken: string, apiKey: string, callId: string, psychologistName: string, psychologistPhotoUrl: string | null, sessionStartAt: string, status: 'waiting' | 'too_early' | 'active' | 'ended' | 'expired' }`
Response (404): `{ error: 'NOT_FOUND' }` — token does not match any room
Response (410): `{ error: 'SESSION_ENDED' }` — room status is 'ended' or 'expired'

The handler:
1. Validates input with Zod
2. Queries `video_rooms` WHERE `patient_token = input.token` OR `partner_token = input.token` (service-role — justified: patient has no Supabase session)
3. Determines status based on `available_from`, `expires_at`, room `status`, current time
4. Returns the pre-minted JWT (stored in `patient_jwt` or `partner_jwt`) and metadata
5. Does NOT log the join yet — that happens client-side when the patient actually connects

Service-role justification comment: "Patient is not a Supabase user; the token in the URL is the authorization credential. Service-role is required to query video_rooms without RLS."

**3. Time-gate states**

The patient page renders based on the `status` field from the Route Handler:

| Status | Condition | UI |
|---|---|---|
| `too_early` | now < available_from | "Sua sessao e as [hora]. Volte 10 minutos antes." + device test option |
| `waiting` | available_from <= now < expires_at AND room status is 'pending' | Waiting room: psychologist name, "Aguarde" message, device test done |
| `active` | room status is 'active' (psychologist admitted) | In-call: connect to Stream call |
| `ended` | room status is 'ended' | "Esta sessao ja foi encerrada." message |
| `expired` | now > expires_at OR room status is 'expired' | "Esta sessao ja foi encerrada." message |

The page polls the Route Handler every 10s when in `waiting` state to detect when the psychologist admits (room status changes to `active`). Alternative considered: Stream Realtime / WebSocket — would be more responsive but adds complexity; 10s polling is adequate for a "waiting room" where the patient expects to wait minutes.

**4. Patient in-call UI: minimal, no branding**

Per RF-09.12:
- Psychologist photo/initials (Avatar component, size lg 56px)
- Psychologist name (h4 weight 500)
- Psychologist video: large area (~75% viewport)
- Patient video: small PiP bottom-right
- Controls: mic toggle, camera toggle, "Sair" button (danger variant)
- No screen share button for patient
- No chat button (change 4)
- Connection quality indicator (reuse from change 2)

Salvia tokens: same surface/border palette as psychologist view. No brand color on the patient page (neutral, trustworthy).

**5. Browser compatibility check**

Before rendering the video UI, check `navigator.mediaDevices` and WebRTC support. If unsupported:
- Show message: "Seu navegador nao e compativel com videochamadas. Use Chrome, Edge, Firefox ou Safari recente."
- Link to download Chrome/Firefox
- No attempt to load Stream SDK

**6. Patient disconnect handling**

When the psychologist ends the call (via `endVideoSession` in change 2), Stream disconnects all participants. The patient's `useCallCallingState()` hook transitions to `LEFT`. The patient UI shows:
- "Sessao encerrada por [Psicologo]."
- "Se precisar reagendar, entre em contato com [Psicologo]."
- No action buttons (the patient has no account to navigate to)

**7. Video session log for patient events**

When the patient joins/leaves, a POST to a lightweight Route Handler `POST /api/video/log` records the event in `video_session_logs`. This handler uses service-role (justified: patient has no Supabase session). Input is Zod-validated: `{ token, event_type, metadata? }`. The handler verifies the token is valid before inserting.

Events logged: `patient_joined`, `patient_left`, `partner_joined`, `partner_left`, `connection_drop`, `reconnected`.

## Frontend — Design System Salvia

### Too-early page

- Centered card, max-width 480px
- Psychologist Avatar (lg, brand-100 bg fallback)
- Title h3: "Sua sessao com [Psicologo]"
- Body: "Esta agendada para [data] as [hora]. Volte 10 minutos antes."
- Button secondary: "Testar camera e microfone" (opens device test inline)
- No brand colors except avatar fallback

### Waiting room

- Same centered layout
- Psychologist Avatar
- Title h3: psychologist name
- Body body-lg: "Aguarde, [Psicologo] vai admitir voce em breve"
- Subtle loading animation (pulsing dot, <300ms cycle, respects reduced-motion)
- Device check summary: green check if camera/mic OK

### In-call (patient)

- Full viewport, same layout principles as psychologist view
- Controls bar: simplified (mic, camera, leave only)
- No elapsed time (patient does not need it)
- Connection quality indicator (reuse)

### Session ended

- Centered card, max-width 480px
- Title h3: "Sessao encerrada"
- Body: message from psychologist or default
- No action buttons

### Accessibility

- All controls: aria-label PT-BR
- Focus trap in waiting room (nothing else to interact with)
- Skip link not needed (single-purpose page)
- Color contrast: all text meets 4.5:1

## Risks / Trade-offs

- [Risk: patient token leaked via URL sharing] → Mitigation: token is call-scoped and time-limited (available_from to expires_at). Even if shared, only max_participants (2-3) can join. Waiting room is the first barrier (psychologist must admit).
- [Risk: polling every 10s for waiting room status] → Mitigation: lightweight POST (no DB writes on poll), small payload. If latency becomes an issue, can upgrade to Stream's native presence/events.
- [Risk: service-role usage in two Route Handlers] → Mitigation: both are justified (patient has no Supabase session), Zod-validated, and the token itself is the authorization credential. Neither handler exposes data beyond what the token grants.
- [Trade-off: no chat for patient in this change] → Accepted to keep scope manageable. Chat toggle is added in change 4.

## Migration Plan

No database migration. Route Handler and page only.

1. Add `/v` to `classifyPath()` as explicit `'public'`
2. Deploy Route Handler + page + components
3. Integration tests for token validation must pass
4. E2E test for golden path must pass

Rollback: remove route and handler. No persistent state affected.

## Open Questions

None blocking.
