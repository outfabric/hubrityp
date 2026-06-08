# telepsicologia-in-call-chat Specification

## Purpose

Ephemeral in-call text chat for telepsychology video sessions: real-time messaging via Stream data channel, drawer UI with unread indicator, messages discarded on call end (no database persistence).

## Requirements

### Requirement: Ephemeral in-call text chat via Stream data channel
The system SHALL provide an ephemeral text chat during video sessions using Stream's call custom events. Messages SHALL NOT be persisted after the session ends. Both psychologist and patient SHALL be able to send and receive messages.

#### Scenario: Psychologist sends a chat message
- **WHEN** the psychologist types a message and clicks send
- **THEN** the message appears in both the psychologist's and patient's chat views

#### Scenario: Messages are ephemeral
- **WHEN** the call ends
- **THEN** all chat messages are discarded (not stored in any database)

### Requirement: Chat drawer UI with unread indicator
The chat SHALL render in a Drawer (right on desktop, bottom on mobile). When closed with unread messages, the toggle button SHALL show a notification dot. The drawer SHALL contain a scrollable message list and a text input with send button.

#### Scenario: Unread indicator shows when drawer is closed
- **WHEN** a new message arrives while the chat drawer is closed
- **THEN** a red notification dot appears on the chat toggle button

#### Scenario: Drawer opens with message history
- **WHEN** the psychologist opens the chat drawer
- **THEN** all messages from the current session are visible in chronological order

### Requirement: Sent messages are never duplicated in the sender's view

The chat SHALL display each message exactly once for every participant, including the sender. Because Stream broadcasts call custom events back to the originating client, the sender receives an echo of their own message in addition to the optimistic local copy. The incoming-event handler SHALL de-duplicate messages by their unique `id` and SHALL ignore any incoming message whose `id` is already present in the message list. This de-duplication SHALL also hold under repeated delivery of the same event (e.g., React StrictMode double-mount or transport redelivery).

#### Scenario: Sender's own message is not duplicated by the echo

- **WHEN** the psychologist (or patient) sends a chat message
- **THEN** the message appears exactly once in their own chat view, even though the optimistic local append and the Stream self-echo both reference it

#### Scenario: Duplicate-id events are dropped

- **WHEN** a custom chat event arrives whose `id` already exists in the current message list
- **THEN** the message list is left unchanged (no second copy is appended)

#### Scenario: A genuinely new message from the other participant still appears once

- **WHEN** the other participant sends a message with an `id` not yet in the list
- **THEN** the message is appended exactly once and rendered in chronological order

### Requirement: Chat drawer UI conforms to the Sálvia design system

The chat drawer SHALL follow `docs/design-system/rules.md` so it is visually consistent with the rest of the platform and with its sibling `prontuario-call-drawer`. The drawer header, scrollable message list, and message input SHALL share a single consistent horizontal inset (no region flush against the drawer edge and no mismatched left edges between header, messages, and input). The message input region SHALL use the platform drawer-footer convention — a plain `surface` background separated by a top border (`border-t border-border`) — rather than a one-off `surface-muted` band. Typography SHALL use the design-system scale tokens (`caption` for sender name/timestamp, `body-sm` for message text) rather than arbitrary pixel values. Spacing SHALL use multiples of 4. The calm, left-aligned "sender-name eyebrow + message text" layout SHALL be preserved (no chat bubbles, no per-sender alignment). Accessibility SHALL be maintained: the message list keeps `role="log"` + `aria-live="polite"`, standalone icon controls keep PT-BR `aria-label`s, interactive elements keep a visible focus ring, and color contrast meets WCAG 2.1 AA.

#### Scenario: Header, messages, and input share one horizontal inset

- **WHEN** the chat drawer is open
- **THEN** the header title, each message row, and the input field all start at the same left inset (consistent alignment, nothing flush to the drawer edge)

#### Scenario: Input region uses the platform drawer-footer pattern

- **WHEN** the chat drawer is open
- **THEN** the message input sits on a `surface` background separated by a `border-t border-border` top border, matching the prontuario drawer footer (not a `surface-muted` band)

#### Scenario: Typography uses design-system tokens

- **WHEN** a message is rendered
- **THEN** the sender name and timestamp use the `caption` scale and the message text uses the `body-sm` scale (no arbitrary `text-[12px]`/`text-[13px]` values)

#### Scenario: Accessibility is preserved

- **WHEN** a new message arrives
- **THEN** it is announced via the `aria-live="polite"` message log, and all standalone controls retain their PT-BR `aria-label`s and visible focus ring
