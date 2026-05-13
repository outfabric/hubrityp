# whatsapp-inbox Specification

## Purpose

Two-column inbox for psychologists to view, search, and reply to patient WhatsApp conversations, with unread/risk indicators, free-text and template replies, and conversation resolution.

## Requirements

### Requirement: Inbox displays paginated conversation list with unread and risk indicators

The system SHALL provide a conversation list at `/app/caixa-de-entrada` showing all conversations with patients who have sent free-text WhatsApp messages. Each entry displays the patient avatar (initials fallback), patient name, last message preview (truncated to 80 characters), relative timestamp, unread indicator (dot), and risk indicator (AlertTriangle icon) when applicable. The list is paginated at 50 items per page, ordered by last_message_at DESC.

#### Scenario: Psychologist sees conversation list with unread messages

- **WHEN** psychologist navigates to `/app/caixa-de-entrada` and has 3 conversations (2 unread, 1 read)
- **THEN** the page displays all 3 conversations ordered by most recent message first, unread conversations show the patient name in semibold (600 weight) with an 8px brand-500 dot, and read conversations show normal weight (400)

#### Scenario: Conversation with risk flag shows danger indicator

- **WHEN** a conversation has `has_risk=true`
- **THEN** the conversation list item displays an `AlertTriangle` icon (16px, danger-500) next to the patient name

#### Scenario: Conversation list paginates at 50 items

- **WHEN** psychologist has 75 conversations
- **THEN** the first page shows 50 conversations and pagination controls appear at the bottom to load the next 25

#### Scenario: Empty inbox shows empty state

- **WHEN** psychologist has no conversations
- **THEN** the page shows `MessageCircle` icon (24px, text-tertiary), heading "Nenhuma mensagem recebida", description "Quando pacientes responderem aos lembretes, as mensagens aparecerao aqui", and no CTA button

### Requirement: Inbox supports filtering by unread, risk, and patient search

The system SHALL provide filters above the conversation list: tabs for "Todas", "Nao lidas", "Risco", and a search input for filtering by patient name.

#### Scenario: Filter by unread conversations only

- **WHEN** psychologist selects the "Nao lidas" tab
- **THEN** only conversations with `unread_count > 0` are displayed

#### Scenario: Filter by risk conversations only

- **WHEN** psychologist selects the "Risco" tab
- **THEN** only conversations with `has_risk = true` are displayed

#### Scenario: Search conversations by patient name

- **WHEN** psychologist types "Marina" in the search input
- **THEN** only conversations where the patient name contains "Marina" (case-insensitive) are displayed

### Requirement: Opening a conversation displays threaded messages and marks as read

The system SHALL display the last 30 messages in chronological order (ASC) when a psychologist opens a conversation. Outbound messages are aligned right with brand-100 background. Inbound messages are aligned left with surface-muted background. Opening a conversation marks all messages as read and resets the unread count to 0.

#### Scenario: Psychologist opens a conversation with unread messages

- **WHEN** psychologist clicks on a conversation with 3 unread messages
- **THEN** the thread displays up to 30 messages chronologically, `read_at_by_psychologist` is set to now() on all unread messages, and `unread_count` in `whatsapp_conversations` is set to 0

#### Scenario: Outbound message displays with delivery status

- **WHEN** the thread contains an outbound message with status "delivered"
- **THEN** the message bubble is aligned right with bg brand-100, text brand-700, radius lg, and shows a `CheckCircle2` icon (12px) in the footer next to the timestamp

#### Scenario: Inbound message with risk flag shows danger border

- **WHEN** the thread contains an inbound message with `risk_flag=true`
- **THEN** the message bubble has a 1.5px danger-500 border and an `AlertTriangle` icon (14px, danger-500) in the corner

### Requirement: Psychologist can send free-text reply within 24-hour session window

The system SHALL allow the psychologist to send a free-text reply when the last inbound message from the patient is less than 24 hours old. The reply is validated against the clinical-content blocker before sending. On success, the message is persisted in `whatsapp_messages` with direction='outbound' and template_key=null, and sent via the Twilio adapter `sendFreeText` method.

#### Scenario: Send free-text reply within 24h window

- **WHEN** psychologist types "Confirmo seu horario de amanha as 14h" and the last inbound message was 2 hours ago
- **THEN** the message is sent via Twilio, persisted with direction='outbound', and appears as a new outbound bubble in the thread

#### Scenario: Free-text reply blocked when clinical content detected

- **WHEN** psychologist types "A paciente apresenta sintomas de ansiedade generalizada" and clicks send
- **THEN** the system blocks the send and displays an Alert warning: "Esse conteudo parece ser clinico. Por politica do WhatsApp e LGPD, conversas clinicas devem ficar no prontuario. Use mensagens administrativas apenas."

#### Scenario: Free-text reply blocked when outside 24h window

- **WHEN** the last inbound message from the patient was 25 hours ago
- **THEN** the free-text composer is disabled and an Alert info is shown: "A janela de 24h expirou. Use um template aprovado." with a "Enviar template..." button

### Requirement: Psychologist can send template reply outside 24-hour session window

The system SHALL provide a template reply fallback when the 24-hour session window has expired. The psychologist selects from approved templates, fills variables, and sends via the existing `renderTemplate` + `sendTemplate` pipeline from changes 1/2.

#### Scenario: Send template reply outside 24h window

- **WHEN** the 24h window has expired and psychologist clicks "Enviar template...", selects "lembrete_24h", fills variables, and clicks "Enviar"
- **THEN** the template is rendered with variables, sent via Twilio `sendTemplate`, and persisted as outbound in `whatsapp_messages` with the template_key

#### Scenario: Template selection dialog shows only approved templates

- **WHEN** psychologist opens the template selection dialog
- **THEN** only templates with `meta_status = 'approved'` are listed in the Combobox

### Requirement: Psychologist can mark a conversation as resolved

The system SHALL allow the psychologist to mark a conversation as resolved, setting `resolved_at` on all messages in that conversation. Resolved conversations can still be viewed but are visually distinguished.

#### Scenario: Mark conversation as resolved

- **WHEN** psychologist clicks "Marcar como resolvida" on a conversation
- **THEN** all messages in the conversation have `resolved_at` set to now()

### Requirement: RLS enforces owner-scoped access on whatsapp_conversations

The system SHALL enable RLS on `whatsapp_conversations` using `user_id = auth.uid()`. A psychologist can only access conversations belonging to them.

#### Scenario: Cross-psychologist conversation access is blocked

- **WHEN** psychologist A queries `whatsapp_conversations`
- **THEN** only conversations belonging to psychologist A are returned

### Requirement: Inbox page uses two-column layout on desktop and Sheet on mobile

The system SHALL render the inbox with a two-column layout on desktop (conversation list 380px left, thread flex right). On mobile, the list is the default view and opening a conversation opens a bottom Sheet.

#### Scenario: Desktop layout shows two columns

- **WHEN** psychologist is on desktop (>=1024px) and opens a conversation
- **THEN** the conversation list remains visible on the left (380px) and the thread opens on the right

#### Scenario: Mobile layout opens thread in Sheet

- **WHEN** psychologist is on mobile (<768px) and taps a conversation
- **THEN** the thread opens in a bottom-up Sheet overlay
