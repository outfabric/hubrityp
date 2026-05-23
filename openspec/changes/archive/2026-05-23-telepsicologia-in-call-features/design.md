## Context

Changes 2 and 3 deliver the core psychologist and patient video call UIs. The call control bar (change 2) already has placeholder slots for chat toggle and screen share button. This change fills in those slots and adds the prontuario drawer and troubleshooting panel.

Stream Video SDK includes a data channel for in-call messaging that does not require the separate Stream Chat SDK. Messages sent via the call's custom events are ephemeral — they exist only for the duration of the call and are not persisted by Stream.

The prontuario module (`src/modules/medical-records/`) already exists with Server Components for evolutions, diagnostic hypotheses, treatment plans, and clinical documents. The drawer will embed these components in a side panel.

## Goals / Non-Goals

**Goals:**

- Ephemeral in-call chat using Stream's call data channel (custom events)
- Chat UI: Drawer (right, desktop) / Sheet (bottom, mobile) with message list and input
- Screen share display: when psychologist shares, patient sees the shared screen as the main video; psychologist sees a "sharing" indicator
- Prontuario side drawer: loads patient prontuario components in a 400px side panel during the call. Only for psychologist
- "Problema tecnico?" help panel with troubleshooting steps
- Quality degradation: "Reduzir qualidade do video" option when connection is poor
- Unit tests for chat message rendering, drawer toggle, help panel content

**Non-Goals:**

- Persistent chat (RF-09.16 explicitly says chat NOT persisted)
- Chat history after session ends
- Rich text or file sharing in chat
- Patient screen sharing (RF-09.14 — only psychologist)
- Prontuario editing capabilities beyond what already exists in the prontuario module (this change just embeds it)
- Video quality settings beyond a simple "reduce quality" toggle

## Decisions

**1. Ephemeral chat via Stream call custom events**

Stream Video SDK supports sending custom events within a call via `call.sendCustomEvent({ type: 'chat-message', data: { text, sender, timestamp } })`. All participants receive the event in real-time. No persistence — when the call ends, messages are gone.

Why not Stream Chat SDK: adding a second SDK increases bundle size and complexity. The PRD explicitly requires non-persistent chat, making the data channel a perfect fit. If persistent chat were needed later, the Chat SDK would be the right choice.

Message format: `{ type: 'chat-message', data: { text: string, senderId: string, senderName: string, timestamp: number } }`. Messages are collected in React state (`useState<ChatMessage[]>`) — when the component unmounts (call ends), they are garbage collected.

**2. Chat UI: Drawer component**

- Desktop: shadcn `Sheet` side="right", width 360px. Overlaps the video area (does not resize it)
- Mobile: shadcn `Sheet` side="bottom", max-height 50vh
- Message list: scrollable, newest at bottom. Each message: sender name (caption style), text (body-sm), timestamp (caption, text-tertiary)
- Input: shadcn `Input` at the bottom with "Enviar" button (ghost, Send icon)
- Toggle: chat icon button in CallControlBar with unread count badge

**3. Screen share rendering**

Stream SDK handles screen share automatically via `SpeakerLayout` — when a participant shares their screen, it becomes the dominant video. The psychologist's CallControlBar already has `ScreenShareButton` from change 2. This change:
- Ensures the patient's view correctly shows the shared screen as the main content
- Adds a "Voce esta compartilhando sua tela" indicator for the psychologist
- Adds a "Parar de compartilhar" button overlay on the shared screen area

No custom rendering needed — Stream's `SpeakerLayout` handles the layout switch. We just need to add the overlay indicators.

**4. Prontuario side drawer**

- Psychologist-only (button hidden from patient view)
- Toggle button in CallControlBar: Lucide `FileText` icon
- Opens a shadcn `Sheet` side="right", width 480px (desktop), full-width (mobile)
- Content: loads the patient's prontuario components via an iframe-less approach — imports the prontuario page's Server Components directly. Since the psychologist is already authenticated and the prontuario components use RLS-scoped queries, no additional auth is needed
- The drawer renders a simplified version: quick evolution form, recent evolutions list, diagnostic hypotheses. Full prontuario page link at the bottom
- Auto-save on evolution edits (same 10s debounce as the prontuario page)

**5. Troubleshooting panel**

- Trigger: "Problema tecnico?" button (Lucide `HelpCircle`, ghost variant) in CallControlBar
- Opens a small popover (not a full drawer) with:
  1. "Verifique se microfone e camera estao ativados nas configuracoes do navegador"
  2. "Saia e volte a entrar pelo mesmo link"
  3. "Tente usar Chrome ou Firefox"
  4. "Se o problema persistir, entre em contato com [Psicologo] por WhatsApp"
- Static content, no API calls

**6. Quality degradation controls**

When `ConnectionQualityIndicator` (change 2) detects poor quality (red):
- Show a non-blocking toast (Sonner warning): "Sua conexao esta instavel."
- Below the toast, action button: "Reduzir qualidade" which calls `call.camera.setPreferredResolution({ width: 320, height: 240 })` (Stream SDK method to lower resolution)
- The setting persists for the duration of the call

## Frontend — Design System Salvia

### Chat drawer

- Sheet right (desktop 360px, mobile bottom 50vh)
- Header: "Chat" h4, close button (X)
- Message bubble: no bubble styling (Salvia prohibits excessive decoration). Sender name in caption-upper, text in body-sm, timestamp in caption text-tertiary. Messages separated by space-2
- Input area: bg surface-muted, padding space-3, Input + ghost Button with Send icon
- Unread badge on toggle button: danger-500 dot, 8px, absolute positioned

### Prontuario drawer

- Sheet right (desktop 480px, mobile full)
- Header: "Prontuario de [Paciente]" h4, close button
- Content: scrollable, same styling as prontuario page but condensed padding (space-4)
- Evolution form: same as existing, auto-save indicator

### Troubleshooting popover

- shadcn Popover, max-width 320px
- Numbered list, body-sm, text-secondary
- No card nesting (Salvia prohibition)

### Accessibility

- Chat: aria-live="polite" on message list for screen readers
- Drawer: focus trap when open, Escape closes
- Troubleshooting: popover follows Radix accessibility patterns

## Risks / Trade-offs

- [Risk: prontuario drawer Server Components in a client-side call context] → Mitigation: the drawer content can be loaded via a nested Server Component boundary using Suspense. The parent sheet is client-side; the content fetches server-side via RSC streaming.
- [Risk: custom event chat messages could be missed if participant briefly disconnects] → Mitigation: messages are ephemeral and informal (backup for when audio drops). Missing a message during a brief disconnect is acceptable — the audio will resume.
- [Trade-off: no persistent chat means no post-session review of chat] → Accepted per RF-09.16. If needed later, can persist to a transient table with 24h TTL.

## Migration Plan

No database migration. Frontend-only change.

Deploy: standard Vercel deploy. Components are lazy-loaded within the existing call UI.
Rollback: revert components. Call UI falls back to change 2/3 state (no chat, no drawer).

## Open Questions

None blocking.
