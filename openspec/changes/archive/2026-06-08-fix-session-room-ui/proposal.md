## Why

During manual testing of the online session room (telepsychology video call), three UI defects were found that degrade the psychologist/patient experience and break visual consistency with the rest of the platform:

1. **Chat messages are duplicated** — every message the local user sends renders twice in their own chat view.
2. **Mic/camera/screen-share buttons look out of place** — the psychologist's in-call control bar uses Stream's stock SDK widgets (different icon set and CSS), clashing with the pre-call lobby and patient bar, which already use the Sálvia design system.
3. **The chat drawer is misaligned** — header, message list, and input each use a different horizontal inset, and the input bar is a one-off pattern, none of which follow the design system.

These are user-visible regressions in a clinical-grade surface and should be fixed together since they live in the same module (`telepsicologia`) and the same screen.

## What Changes

- **Chat de-duplication (#1):** The chat drawer's incoming-event listener will ignore the sender's own echoed message and de-duplicate by message `id` (Stream broadcasts custom events back to the sender; combined with the optimistic local append this produced the double render). De-dup-by-`id` is the chosen strategy — it also guards against React StrictMode double-effects and any future event redelivery.
- **Control-bar button unification (#2):** Replace the psychologist control bar's three Stream built-in widgets (`ToggleAudioPublishingButton`, `ToggleVideoPublishingButton`, `ScreenShareButton`) with design-system buttons (shadcn `Button` + Lucide icons), driven by Stream's call-state hooks. A single shared `DeviceToggleButton` component will back the mic/camera (and screen-share) controls and be reused across the pre-call lobby, the patient bar, and the psychologist bar (rule-of-three extraction). Screen-share active state is derived from `status === 'enabled'` (unambiguous), and screen-share remains psychologist-only. All toggles gain the lobby's permission-error handling for true behavior parity (not just visual parity).
- **Chat layout/formatting (#3):** Give the chat drawer one consistent horizontal inset and proper header/footer rhythm, matching the sibling `prontuario-call-drawer` (plain `surface` footer with `border-t border-border`, not a `bg-surface-muted` band). Tokenize typography to the design-system scale (`caption` / `body-sm`) instead of arbitrary `text-[12px]`/`text-[13px]` values. Calm, left-aligned "name eyebrow + text" message style is preserved (no chat bubbles).
- **No backend/data-model change:** chat stays ephemeral (Stream custom events, no DB persistence, no Server Action, no RLS surface). No migrations, no API routes, no env changes.
- **Tests:** add/extend unit, integration (where a real boundary exists), and e2e coverage for the affected behaviors, with each test introduced immediately alongside the code change it validates. Existing `data-testid`s relied on by current tests are preserved.

## Capabilities

### New Capabilities

<!-- None. Both affected behaviors already have specs; this change modifies their requirements. -->

### Modified Capabilities

- `telepsicologia-in-call-chat`: add a requirement that a sender never sees their own message duplicated (de-dup by `id`, ignore self-echo); add a requirement that the chat drawer UI conforms to the Sálvia design system (consistent inset, header/footer padding/rhythm, footer pattern parity with the prontuario drawer, tokenized typography, WCAG AA).
- `telepsicologia-call-controls`: modify the call-control-bar requirement so mic/camera/screen-share render as design-system buttons (shadcn + Lucide) via a shared `DeviceToggleButton`, consistent across lobby/patient/psychologist surfaces; screen-share driven by Stream call-state hooks with `status === 'enabled'`; device toggles surface a PT-BR permission error when the browser denies camera/mic access.

## Impact

- **Affected code (frontend, `src/modules/telepsicologia/`):**
  - `components/chat-drawer.tsx` (#1 de-dup, #3 layout)
  - `components/chat-message-list.tsx`, `components/chat-input.tsx` (#3 layout + typography tokens)
  - `components/call-control-bar.tsx` (#2 psychologist controls → design-system buttons)
  - `components/pre-call-lobby.tsx`, `components/patient-in-call-view.tsx` (#2 refactor onto shared `DeviceToggleButton`; patient/psychologist gain permission-error handling)
  - **New:** `components/device-toggle-button.tsx` (shared mic/camera/screen-share toggle)
- **Design system:** all changed UI follows `docs/design-system/rules.md` (spacing multiples of 4, `caption`/`body-sm` scale, drawer/footer conventions, Lucide stroke 1.5 from the fixed icon map, focus ring, `aria-label`s, WCAG 2.1 AA, dark mode via tokens).
- **External dependency:** `@stream-io/video-react-sdk` call-state hooks (`useMicrophoneState`, `useCameraState`, `useScreenShareState`, `useHasOngoingScreenShare`) — APIs to be confirmed via Context7 when writing `design.md`.
- **Security/LGPD:** no new trust boundary. Chat remains ephemeral and client-only — no PII persisted, no PII logged, no server input added. Threat-model surface is unchanged by this change.
- **Tests:** `src/__tests__/unit/modules/telepsicologia/**` and `src/__tests__/e2e/seeded/**` (telepsicologia in-call flows); preserve existing `data-testid`s.
- **No impact:** database schema, RLS policies, Server Actions, Route Handlers, migrations, env, middleware/route gating.
