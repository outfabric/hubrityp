# whatsapp-message-history Specification

## Purpose

Full-text search across WhatsApp message history with Postgres tsvector, scoped by psychologist via RLS, with patient and date-range filtering.

## Requirements

### Requirement: Psychologist can search message history with full-text search

The system SHALL provide full-text search across `whatsapp_messages.body` using Postgres tsvector with the `portuguese` text search configuration and `coalesce(body, '')` (template sends have `body = NULL` and are therefore not matchable by content — accepted: their content is fixed boilerplate). Search is scoped by the authenticated psychologist (RLS) and supports filtering by patient_id and date range. Results are paginated.

#### Scenario: Search messages by keyword

- **WHEN** psychologist searches for "confirmar" in the message history
- **THEN** all messages containing "confirmar" (or stemmed variants like "confirmacao") belonging to that psychologist are returned, paginated

#### Scenario: Template sends are not matched by content

- **WHEN** psychologist searches for a word that appears only in the Meta-approved template copy of a sent reminder (row with body=NULL)
- **THEN** that row is not returned by the full-text match and the query does not error on the NULL body

#### Scenario: Search filtered by patient and date range

- **WHEN** psychologist searches for "sessao" filtered to patient "Marina Silva" and date range 2026-05-01 to 2026-05-31
- **THEN** only messages matching the keyword, patient, and date range are returned

#### Scenario: Search respects RLS

- **WHEN** psychologist A searches for messages
- **THEN** only messages belonging to psychologist A are included in results, never messages from psychologist B

#### Scenario: Empty search returns no results with helpful message

- **WHEN** psychologist searches for "xyznonexistent"
- **THEN** the system returns an empty result set with message "Nenhuma mensagem encontrada"

### Requirement: History display derives template send rows from template_key and status

Outbound rows with `body IS NULL` and a non-null `template_key` SHALL be displayed using the human-readable template label (`TEMPLATE_LABELS[template_key]`, e.g. "Lembrete 24h") plus the delivery status — never as an empty/blank message. This applies to every surface that renders `whatsapp_messages` rows (message history, and the inbox thread when its flag is enabled later). Rows with a populated `body` (inbound and free-form outbound) keep rendering the body text.

#### Scenario: Template send row rendered with label and status

- **WHEN** the history lists an outbound row with body=NULL and template_key="lembrete_24h" and status="delivered"
- **THEN** the row displays "Lembrete 24h" (label) with its delivery status, not an empty body

#### Scenario: Unknown template_key falls back to the raw key

- **WHEN** a row has body=NULL and a template_key not present in `TEMPLATE_LABELS` (e.g. the historical `confirmacao_recebida`)
- **THEN** the row displays the raw template_key string with its status instead of blank content

#### Scenario: Free-form rows keep showing their body

- **WHEN** the history lists an outbound free-form row (body populated, template_key=NULL)
- **THEN** the row displays the body text
