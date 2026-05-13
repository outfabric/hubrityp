# whatsapp-message-history Specification

## Purpose

Full-text search across WhatsApp message history with Postgres tsvector, scoped by psychologist via RLS, with patient and date-range filtering.

## Requirements

### Requirement: Psychologist can search message history with full-text search

The system SHALL provide full-text search across `whatsapp_messages.body` using Postgres tsvector with the `portuguese` text search configuration. Search is scoped by the authenticated psychologist (RLS) and supports filtering by patient_id and date range. Results are paginated.

#### Scenario: Search messages by keyword

- **WHEN** psychologist searches for "confirmar" in the message history
- **THEN** all messages containing "confirmar" (or stemmed variants like "confirmacao") belonging to that psychologist are returned, paginated

#### Scenario: Search filtered by patient and date range

- **WHEN** psychologist searches for "sessao" filtered to patient "Marina Silva" and date range 2026-05-01 to 2026-05-31
- **THEN** only messages matching the keyword, patient, and date range are returned

#### Scenario: Search respects RLS

- **WHEN** psychologist A searches for messages
- **THEN** only messages belonging to psychologist A are included in results, never messages from psychologist B

#### Scenario: Empty search returns no results with helpful message

- **WHEN** psychologist searches for "xyznonexistent"
- **THEN** the system returns an empty result set with message "Nenhuma mensagem encontrada"
