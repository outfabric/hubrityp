## Context

The online session room (`src/modules/telepsicologia/`) renders three surfaces that share mic/camera controls and an in-call chat:

- **Pre-call lobby** (`pre-call-lobby.tsx`) — custom shadcn `Button` + Lucide `Mic/MicOff`, `Video/VideoOff`, with permission-error handling. This is the desired look.
- **Patient call bar** (`PatientCallControls` in `patient-in-call-view.tsx`) — already custom shadcn + Lucide for mic/camera (no screen share), but its `microphone.toggle()` / `camera.toggle()` are fire-and-forget (no permission-error handling).
- **Psychologist call bar** (`call-control-bar.tsx`) — uses Stream's built-in `ToggleAudioPublishingButton`, `ToggleVideoPublishingButton`, `ScreenShareButton`, which ship Stream's own icon set and CSS. This is the visual outlier.

The chat (`chat-drawer.tsx`, `chat-message-list.tsx`, `chat-input.tsx`) is ephemeral: messages live in React state and are sent/received via Stream call custom events (`call.sendCustomEvent` / `call.on('custom')`). No DB, no Server Action, no persistence.

Two confirmed Stream facts drive this design:

1. **Stream echoes a sender's own custom event back to them.** The repo already relies on this in the unread-badge listeners (`in-call-view.tsx`, `patient-in-call-view.tsx`) which filter `senderId !== currentUser.id`. The chat message-list listener does not filter or de-dup, so the optimistic local append + the echo render every sent message twice.
2. **Stream call-state hooks back custom controls** (verified via Context7, Stream React SDK "Replacing call controls" + "Camera and microphone" guides):
   - `useMicrophoneState()` → `{ microphone, isMute }`; `await microphone.toggle()`
   - `useCameraState()` → `{ camera, isMute }`; `await camera.toggle()`
   - `useScreenShareState()` → `{ screenShare, status }`; `await screenShare.toggle()`; active when `status === 'enabled'`
   - `useHasOngoingScreenShare()` → boolean (someone is sharing)
   These are the exact hooks the lobby and patient bar already import, so no new dependency or API surface is introduced.

## Goals / Non-Goals

**Goals:**

- Each chat message renders exactly once for its sender (fix duplication) — robust to self-echo and event redelivery.
- Mic/camera/screen-share controls are visually identical across lobby, patient bar, and psychologist bar, using the Sálvia design system (shadcn `Button` + Lucide), via one shared `DeviceToggleButton`.
- Mic/camera toggles surface a PT-BR permission error on denial on every surface (behavior parity, not just visual).
- The chat drawer conforms to `docs/design-system/rules.md`: one consistent inset, footer pattern parity with `prontuario-call-drawer`, tokenized typography, preserved a11y.
- Each code change is accompanied by its test in the same step (unit / e2e as relevant), preserving existing `data-testid`s.

**Non-Goals:**

- No chat persistence, history, or backend storage — chat stays ephemeral.
- No chat bubbles or per-sender alignment — the calm "name eyebrow + text" layout is kept.
- No change to recording, prontuario drawer, connection-quality, elapsed-time, admit/waiting-room, or token-minting behavior.
- No DB/RLS/migration/Server Action/Route Handler/middleware change.
- No change to the `SheetTitle` font convention used by both call drawers (chat + prontuario both use `text-[16px] font-medium`); changing only chat would create a new inconsistency, so this is left as-is.

## Decisions

### D1 — Chat de-duplication by `id` (Strategy B), in `chat-drawer.tsx`

The incoming-event handler appends only when the `id` is not already present:

```ts
setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
```

Rationale: `id` is a `crypto.randomUUID()` generated once at send time and carried in the payload, so the optimistic local copy and the echoed copy share the same `id`. De-dup-by-`id` neutralizes the self-echo **and** any double-delivery (React StrictMode double-mount of the effect, transport redelivery) with a single guard. We also keep an explicit self-skip (`if (payload.senderId === currentUser.id) return;`) as defense-in-depth and to mirror the existing unread-listener pattern — but correctness does not depend on it; the `id` check is the load-bearing fix. The subscription effect keeps its single `unsubscribe` cleanup so listeners don't stack across re-renders (a stacked listener would re-introduce duplicates).

### D2 — Shared `DeviceToggleButton` component (rule-of-three extraction)

New leaf `src/modules/telepsicologia/components/device-toggle-button.tsx` (`'use client'`), a presentational wrapper over shadcn `Button` + Lucide. It does NOT call Stream hooks itself — callers pass state + handler, keeping it pure and testable:

```ts
type DeviceKind = 'mic' | 'camera' | 'screenshare';

interface DeviceToggleButtonProps {
  kind: DeviceKind;
  /** true = off/muted (variant "outline"); false = on (variant "ghost"). */
  isOff: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Required PT-BR label for the standalone icon button. */
  ariaLabel: string;
  'data-testid'?: string;
}
```

Icon map (from the design-system fixed Lucide set): mic → `Mic`/`MicOff`, camera → `Video`/`VideoOff`, screenshare → `ScreenShare`/`ScreenShareOff`. Visual treatment matches the lobby exactly: `size="icon"`, `variant={isOff ? 'outline' : 'ghost'}`, icon `h-5 w-5` `aria-hidden`, Lucide stroke 1.5 (design-system default). The three consumers (lobby, patient bar, psychologist bar) own the Stream hooks and pass `isOff`/`onToggle` down.

### D3 — Screen-share control via hooks, `status === 'enabled'`

In `call-control-bar.tsx` (psychologist only):

```ts
const { useScreenShareState, useHasOngoingScreenShare } = useCallStateHooks();
const { screenShare, status } = useScreenShareState();
const isSharing = status === 'enabled';
const someoneElseSharing = useHasOngoingScreenShare();
// <DeviceToggleButton kind="screenshare" isOff={!isSharing}
//   disabled={!isSharing && someoneElseSharing}
//   onToggle={() => void screenShare.toggle().catch(...)} ariaLabel=... />
```

We deliberately derive the active state from `status === 'enabled'` rather than the `isMute` alias the Stream cookbook uses for screen share, because that alias is semantically inverted/ambiguous and easy to get wrong. Screen share stays psychologist-only and is omitted from the patient bar.

### D4 — Permission-error handling parity

Mic/camera toggles return a Promise. Each consumer wraps `toggle()` with the lobby's existing pattern — clear the error on success, set a PT-BR message on failure — instead of fire-and-forget:

```ts
void microphone.toggle().then(() => setPermissionError(null))
  .catch(() => setPermissionError('Não foi possível acessar o microfone. Verifique as permissões do navegador.'));
```

The patient bar gains a local `permissionError` state + an inline `AlertCircle` message region (same copy/markup as the lobby). The psychologist bar surfaces it consistently with how `RecordingControls` already renders inline errors (small `danger-600`/`danger-700` text, `role="alert"`). Copy follows the design-system microcopy rules (human, PT-BR, no stack traces).

### D5 — Chat drawer layout to design-system

`SheetContent` (Sálvia) is intentionally padding-less (`flex flex-col gap-4`), so each region must supply its own inset. Apply one consistent horizontal inset across header, message list, and input (align to the sibling `prontuario-call-drawer`, which uses `p-4` body + a bordered footer). Concretely:

- **Header:** give `SheetHeader` the shared horizontal inset + top padding so the title is not flush to the corner (e.g. `px-4 pt-4`), keeping clear of the absolutely-positioned close `X` (`top-4 right-4`).
- **Message list:** keep `flex-1 overflow-y-auto`, use the shared inset (`px-4`), increase inter-message gap to a 4-multiple consistent with list rhythm.
- **Input (footer):** replace the `bg-surface-muted` band with the drawer-footer convention — plain `surface` + `border-t border-border`, `px-4 py-3` — matching the prontuario drawer footer; remove the unintended `gap-4` floating gap above it.
- **Typography tokens:** sender name/timestamp → `caption` (12px / 500; name keeps `caption-upper` tracking+uppercase), message text → `body-sm` (13px / 400). Replace arbitrary `text-[12px]`/`text-[13px]` with the scale.
- All existing `data-testid`s (`chat-drawer`, `chat-message-list`, `chat-input`, `chat-input-field`, `chat-send-button`) are preserved. Dark mode is automatic via tokens; contrast verified WCAG 2.1 AA.

### D6 — Test strategy (each test alongside its code change)

- **Unit (Vitest + RTL)** — primary layer, since this is client UI/logic:
  - `chat-message-list` / `chat-drawer` dedup: simulate a `custom` event echoing a just-sent message (same `id`) → asserted single render; duplicate-id event → no growth; new `id` from other participant → appended once.
  - `device-toggle-button`: renders correct Lucide icon + `variant` per `isOff`, fires `onToggle`, respects `disabled`, exposes `aria-label`.
  - permission-error: a rejected `toggle()` promise surfaces the PT-BR message on patient + psychologist bars.
- **e2e (Playwright seeded)** — extend the existing telepsicologia in-call spec: send a chat message and assert it appears exactly once for the sender; assert the in-call mic/camera/screen-share buttons render the Lucide-based controls (by `data-testid`/`aria-label`) consistent with the lobby. Reuse the established mock-GoTrue + seeded-room harness.
- **Integration** — none added: there is no new real boundary (no DB/Server Action/RLS). Stated explicitly so the implementer doesn't invent one.
- Each task in `tasks.md` pairs the code edit with its test in the same section so the implementing agent writes the test while the change is fresh.

## Risks / Trade-offs

- **Losing Stream's built-in edge handling.** Stream's widgets auto-handle some device/disabled states. Mitigation: the lobby and patient bar already prove the custom approach works mid-call with the same hooks; we port the lobby's permission-error handling so the custom buttons are not a behavior downgrade.
- **`data-testid` / selector drift breaking existing tests.** Mitigation: preserve all current `data-testid`s; treat any rename as a deliberate, test-updated change. The chat duplication fix is itself covered by a new assertion so the regression cannot silently return.
- **Screen-share state semantics.** Using `isMute` for screen share is ambiguous; we standardize on `status === 'enabled'` (D3) to avoid an inverted icon/disabled state.
- **Listener stacking.** If the dedup-effect's dependency array or cleanup is altered incorrectly, duplicate listeners could re-introduce doubles. Mitigation: keep the single `call.on('custom')` subscription with its `unsubscribe` cleanup; the `id` dedup also masks accidental double-subscription.
- **Security/LGPD: unchanged surface.** No new trust boundary, no new server input, no PII persisted or logged — chat remains ephemeral and client-only. This change does not alter the module's threat model; standard adversarial review still applies but finds no new sink.
