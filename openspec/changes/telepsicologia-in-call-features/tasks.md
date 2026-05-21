## 1. In-call text chat

- [ ] 1.1 Create `src/modules/telepsicologia/components/chat-message-list.tsx` — `'use client'` component. Props: { messages: ChatMessage[] }. Renders scrollable list of messages: sender name (caption-upper), text (body-sm), timestamp (caption text-tertiary). Auto-scrolls to bottom on new message. aria-live="polite" on container for screen reader announcements
- [ ] 1.2 Create `src/modules/telepsicologia/components/chat-input.tsx` — `'use client'` component. Input field + "Enviar" ghost Button with Send icon (Lucide). Submits on Enter or button click. Clears input after send. Props: { onSend: (text: string) => void }
- [ ] 1.3 Create `src/modules/telepsicologia/components/chat-drawer.tsx` — `'use client'` component. shadcn Sheet side="right" (desktop 360px) / side="bottom" (mobile 50vh). Header "Chat" h4 + close button. Integrates ChatMessageList + ChatInput. Uses Stream call custom events: `call.sendCustomEvent({ type: 'chat-message', data: { text, senderId, senderName, timestamp } })`. Listens for incoming custom events via `call.on('custom', handler)`. Stores messages in useState (ephemeral). Props: { open, onOpenChange, call, currentUser }
- [ ] 1.4 Update `src/modules/telepsicologia/components/call-control-bar.tsx` — replace the chat placeholder button with a functional toggle that opens ChatDrawer. Add unread count badge (danger-500 dot, 8px) when drawer is closed and new messages arrive
- [ ] 1.5 Add ChatDrawer to patient in-call view (`patient-in-call-view.tsx`) — patient can also send/receive chat messages. Same Sheet UI
- [ ] 1.6 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/chat-drawer.test.tsx` — mock Stream call. Tests: renders messages in order, sends message via custom event on submit, clears input after send, new incoming message appended, drawer toggles open/close

## 2. Screen share enhancements

- [ ] 2.1 Create `src/modules/telepsicologia/components/screen-share-indicator.tsx` — `'use client'` component. When psychologist is sharing: overlay banner "Voce esta compartilhando sua tela" + "Parar de compartilhar" button (danger-500 text). Uses Stream's `useCallStateHooks().useScreenShareState()` or equivalent hook
- [ ] 2.2 Update `src/modules/telepsicologia/components/in-call-view.tsx` — add ScreenShareIndicator overlay when sharing is active. Verify that Stream's SpeakerLayout correctly switches to show shared screen as main content for both psychologist and patient views
- [ ] 2.3 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/screen-share-indicator.test.tsx` — mock Stream hooks. Tests: indicator visible when sharing, hidden when not sharing, "Parar" button calls correct Stream method

## 3. Prontuario side drawer

- [ ] 3.1 Create `src/modules/telepsicologia/components/prontuario-call-drawer.tsx` — `'use client'` component. shadcn Sheet side="right" (desktop 480px, mobile full). Header "Prontuario de [Paciente]" h4 + close button. Content: Suspense boundary wrapping a Server Component that loads recent evolutions and a quick evolution form for the patient. Auto-save on evolution edits (10s debounce). Link at bottom "Abrir prontuario completo" -> /pacientes/[patientId]/prontuario
- [ ] 3.2 Create `src/modules/telepsicologia/components/prontuario-call-content.tsx` — Server Component loaded inside the drawer's Suspense boundary. Fetches recent evolutions (last 5) and renders a simplified evolution creation form. Uses existing prontuario module Server Actions for CRUD. RLS-scoped (psychologist is authenticated)
- [ ] 3.3 Update `src/modules/telepsicologia/components/call-control-bar.tsx` — add prontuario toggle button (FileText icon, ghost variant) for psychologist only. Hidden from patient view. Opens ProntuarioCallDrawer
- [ ] 3.4 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/prontuario-call-drawer.test.tsx` — mock Suspense content. Tests: drawer opens/closes, header shows patient name, "Abrir prontuario completo" link has correct href

## 4. Troubleshooting help panel

- [ ] 4.1 Create `src/modules/telepsicologia/components/troubleshooting-popover.tsx` — `'use client'` component. shadcn Popover triggered by HelpCircle icon (ghost button). Max-width 320px. Content: numbered list of troubleshooting steps in body-sm text-secondary. Steps: (1) Verifique mic/camera no navegador, (2) Saia e volte pelo mesmo link, (3) Use Chrome ou Firefox, (4) Contate seu psicologo. For patient view: step 4 includes psychologist name. Static content, no API calls
- [ ] 4.2 Add troubleshooting button to both psychologist and patient CallControlBar / controls
- [ ] 4.3 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/troubleshooting-popover.test.tsx` — tests: popover opens on click, contains troubleshooting steps, closes on Escape

## 5. Connection quality degradation controls

- [ ] 5.1 Update `src/modules/telepsicologia/components/connection-quality-indicator.tsx` (from change 2) — when quality is 'poor' (red), show Sonner warning toast "Sua conexao esta instavel" with action button "Reduzir qualidade". On action: call `call.camera.setPreferredResolution({ width: 320, height: 240 })` to lower video resolution. Show toast only once per degradation episode (debounce)
- [ ] 5.2 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/connection-quality-degradation.test.tsx` — mock Stream hooks + Sonner. Tests: toast shown when quality drops to poor, "Reduzir qualidade" calls resolution change, toast not repeated within 30s

## 6. Module barrel update

- [ ] 6.1 Update `src/modules/telepsicologia/index.ts` — add re-exports for: ChatDrawer, ChatMessageList, ChatInput, ScreenShareIndicator, ProntuarioCallDrawer, TroubleshootingPopover
