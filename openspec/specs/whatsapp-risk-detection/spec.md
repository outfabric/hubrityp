# whatsapp-risk-detection Specification

## Purpose

Automatic risk-keyword scanning of inbound WhatsApp messages with in-app danger notifications, configurable keyword list, and explicit no-auto-response policy.

## Requirements

### Requirement: Inbound messages are scanned for risk keywords and flagged

The system SHALL scan every inbound free-text message for risk keywords using a curated PT-BR dictionary. When a match is found, the message is flagged with `risk_flag=true` and the matched keywords are stored in `risk_keywords` (JSONB array). Detection uses case-insensitive regex with accent normalization and word-boundary matching.

#### Scenario: Message containing "me matar" is flagged

- **WHEN** a patient sends "nao consigo mais, quero me matar"
- **THEN** the message is persisted with `risk_flag=true` and `risk_keywords=["me matar"]`

#### Scenario: Message containing accented variant is flagged

- **WHEN** a patient sends "pensando em suicidio"
- **THEN** the message is flagged with `risk_flag=true` and `risk_keywords=["suicidio"]`

#### Scenario: False positive phrase is not flagged

- **WHEN** a patient sends "estou morrendo de saudade da sessao"
- **THEN** the message is persisted with `risk_flag=false` (common false-positive phrase excluded)

#### Scenario: Multiple risk keywords are all captured

- **WHEN** a patient sends "quero me matar, penso em autolesao"
- **THEN** the message is flagged with `risk_keywords=["me matar", "autolesao"]`

### Requirement: Risk-flagged message triggers immediate in-app danger notification

The system SHALL send an in-app notification with danger variant to the psychologist when a risk-flagged message is detected. The notification has `AlertTriangle` icon, title "Mensagem com alerta de risco recebida de [paciente]", and links to the conversation. The Toast (Sonner) uses border-left danger-500 and does NOT auto-dismiss (autoDismiss=0).

#### Scenario: Psychologist receives persistent danger toast for risk message

- **WHEN** patient "Marina Silva" sends a message containing "acabar com tudo"
- **THEN** the psychologist sees a Sonner toast with danger styling (border-left danger-500), title "Mensagem com alerta de risco recebida de Marina", and the toast remains until manually dismissed

#### Scenario: Risk conversation shows danger banner in thread

- **WHEN** psychologist opens a conversation that has `has_risk=true`
- **THEN** an Alert danger banner appears at the top of the thread: "Mensagem com conteudo de risco detectado. Atencao: avalie pessoalmente. O sistema NAO substitui escuta clinica." with a "Saiba mais" link

### Requirement: System does NOT auto-respond to patients on risk detection

The system SHALL NOT send any automatic response to the patient when risk keywords are detected. Risk detection only triggers an in-app alert to the psychologist. The psychologist reads and responds personally.

#### Scenario: Risk detection does not trigger outbound message

- **WHEN** a patient sends a message flagged with risk keywords
- **THEN** no outbound WhatsApp message is sent automatically, and only an in-app notification is created for the psychologist

### Requirement: Psychologist can configure custom risk keywords

The system SHALL allow the psychologist to edit the risk-keyword list via Configuracoes > Lembretes > Avancado. The configuration UI provides a Textarea (one keyword per line) with a helper text disclaimer.

#### Scenario: Psychologist adds a custom risk keyword

- **WHEN** psychologist adds "desistir de tudo" to the keyword list and saves
- **THEN** future inbound messages containing "desistir de tudo" are flagged with `risk_flag=true`

#### Scenario: Risk keyword config shows disclaimer

- **WHEN** psychologist opens the risk keyword configuration
- **THEN** the page shows helper text: "Heuristica — nunca substitui escuta clinica"
