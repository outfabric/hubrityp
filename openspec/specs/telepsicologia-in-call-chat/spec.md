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
