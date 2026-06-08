## 1. Chat message de-duplication (#1)

- [x] 1.1 In `src/modules/telepsicologia/components/chat-drawer.tsx`, fix the `call.on('custom')` handler so a sent message is never duplicated: de-dup by `id` in the `setMessages` updater (`prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]`) and add a self-skip (`if (payload.senderId === currentUser.id) return;`) as defense-in-depth. Keep the single subscription with its `unsubscribe` cleanup so listeners do not stack. Preserve all existing `data-testid`s.
- [x] 1.2 Add unit test (Vitest + RTL) at `src/__tests__/unit/modules/telepsicologia/components/chat-drawer.test.tsx`: simulate a `custom` event echoing a just-sent message (same `id`) and assert the sender sees it exactly once; assert a duplicate-`id` event does not grow the list; assert a new `id` from the other participant is appended exactly once and in order.

## 2. Shared `DeviceToggleButton` (#2)

- [x] 2.1 Create `src/modules/telepsicologia/components/device-toggle-button.tsx` (`'use client'`): a pure presentational wrapper over shadcn `Button` + Lucide icons with props `{ kind: 'mic' | 'camera' | 'screenshare'; isOff: boolean; onToggle: () => void; disabled?: boolean; ariaLabel: string; 'data-testid'?: string }`. Icon map: mic → `Mic`/`MicOff`, camera → `Video`/`VideoOff`, screenshare → `ScreenShare`/`ScreenShareOff`. Visual treatment matches the lobby: `size="icon"`, `variant={isOff ? 'outline' : 'ghost'}`, icon `h-5 w-5` `aria-hidden`. Do NOT call Stream hooks inside the component (callers own state). Export it from the module barrel if other modules need it (otherwise keep internal).
- [x] 2.2 Add unit test at `src/__tests__/unit/modules/telepsicologia/components/device-toggle-button.test.tsx`: renders the correct Lucide icon and `variant` for `isOff` true/false per `kind`; fires `onToggle` on click; respects `disabled`; exposes the provided `aria-label`.

## 3. Psychologist call bar → design-system controls (#2)

- [x] 3.1 In `src/modules/telepsicologia/components/call-control-bar.tsx`, remove the Stream built-ins (`ToggleAudioPublishingButton`, `ToggleVideoPublishingButton`, `ScreenShareButton`) and render mic/camera/screen-share via `DeviceToggleButton`. Drive mic/camera with `useMicrophoneState()` / `useCameraState()` (`isMute`, `.toggle()`); drive screen share with `useScreenShareState()` (active = `status === 'enabled'`) + `useHasOngoingScreenShare()` (disable when someone else shares). Keep screen-share psychologist-only. Wrap each `toggle()` with `.catch()` that surfaces a PT-BR permission error inline (consistent with `RecordingControls` error rendering, `role="alert"`). Preserve existing aria-labels and `data-testid`s (chat/prontuario/recording/end-call buttons unchanged).
- [x] 3.2 Add unit test at `src/__tests__/unit/modules/telepsicologia/components/call-control-bar.test.tsx` (mock the Stream call-state hooks): asserts mic/camera/screen-share render the Lucide-based controls with correct variant per state; screen-share button is `disabled` when `useHasOngoingScreenShare()` is true and the user is not sharing; a rejected `toggle()` surfaces the PT-BR permission message.

## 4. Patient call bar parity (#2)

- [x] 4.1 In `src/modules/telepsicologia/components/patient-in-call-view.tsx` (`PatientCallControls`), refactor mic/camera onto `DeviceToggleButton` and add the lobby's permission-error handling: local `permissionError` state, `.then(() => setPermissionError(null))` / `.catch(() => setPermissionError('Não foi possível acessar o microfone…'))`, and an inline `AlertCircle` message region matching the lobby. Keep NO screen-share control. Preserve `patient-chat-toggle-button`, `patient-chat-unread-badge`, `patient-leave-button` and other `data-testid`s.
- [x] 4.2 Add unit test at `src/__tests__/unit/modules/telepsicologia/components/patient-call-controls.test.tsx`: mic/camera use `DeviceToggleButton`; no screen-share control is rendered; a denied `toggle()` surfaces the PT-BR error.

## 5. Pre-call lobby onto shared control (#2)

- [ ] 5.1 In `src/modules/telepsicologia/components/pre-call-lobby.tsx`, refactor the existing mic/camera buttons to use `DeviceToggleButton` (no behavior change — keep the current `toggle().then/catch` permission handling and the mic-level meter). This completes the rule-of-three so all three surfaces share one component.
- [ ] 5.2 Update/extend the lobby unit test (if present at `src/__tests__/unit/modules/telepsicologia/components/pre-call-lobby.test.tsx`, else add a focused case) to assert mic/camera render via `DeviceToggleButton` with the correct variant per mute state and that permission errors still surface.

## 6. Chat drawer layout to design system (#3)

- [ ] 6.1 In `chat-drawer.tsx`, apply one consistent horizontal inset across header, message list, and input; give `SheetHeader` `px-4 pt-4` so the title is not flush to the corner and clears the close `X`; remove the unintended `gap-4` floating gap above the input. Drop the chat-input `bg-surface-muted` band.
- [ ] 6.2 In `chat-input.tsx`, render the input region as the platform drawer-footer (plain `surface` + `border-t border-border`, `px-4 py-3`) matching `prontuario-call-drawer`. Keep `chat-input`, `chat-input-field`, `chat-send-button` testids and `maxLength`.
- [ ] 6.3 In `chat-message-list.tsx`, use the shared `px-4` inset, tokenize typography (sender name/timestamp → `caption`, name keeps `caption-upper`; message text → `body-sm`), and set inter-message gap to a 4-multiple. Keep `role="log"` + `aria-live="polite"`, `chat-message-list` testid, and auto-scroll behavior.
- [ ] 6.4 Extend/add unit tests for the chat components asserting: header/list/input share the same inset class, the input uses `border-t` (not `surface-muted`), and typography uses the design-system scale tokens. (Co-locate with the existing chat component tests.)

## 7. End-to-end coverage (cross-cutting safeguard)

- [ ] 7.1 Extend the seeded telepsicologia in-call e2e spec under `src/__tests__/e2e/seeded/**` (reuse the existing mock-GoTrue + seeded-room harness): as the psychologist, send a chat message and assert it appears exactly once in the sender's chat view; assert the in-call mic/camera/screen-share controls render the Lucide-based design-system buttons (by `data-testid`/`aria-label`) consistent with the lobby. If a fresh build is required, rebuild before `next start`.

