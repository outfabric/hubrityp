## ADDED Requirements

### Requirement: Analytics dashboard displays monthly messaging summary

The system SHALL provide an analytics page at `/app/configuracoes/lembretes/historico` showing summary cards for the selected period: total sent, delivery rate (%), read rate (%), confirmation rate (%), and estimated cost (R$). Default period is the current month.

#### Scenario: Current month summary with all metrics

- **WHEN** psychologist navigates to `/app/configuracoes/lembretes/historico` with 100 messages sent in the current month (90 delivered, 80 read, 60 with session confirmed, 5 failed)
- **THEN** the page displays cards: "Enviadas no mês" = 100, "Taxa de entrega" = 90%, "Taxa de leitura" = 80%, "Taxa de confirmação" = 60%, "Custo estimado" = "R$ 10,00" (100 x R$ 0.10)

#### Scenario: Period filter changes displayed metrics

- **WHEN** psychologist selects "Mes anterior" in the period filter
- **THEN** the summary cards and message table update to show data from the previous calendar month

#### Scenario: Custom date range via calendar picker

- **WHEN** psychologist selects "Personalizado" and picks 2026-04-15 to 2026-05-15
- **THEN** the summary cards show aggregated data for that custom range

### Requirement: Analytics page includes searchable message history table

The system SHALL display a table of individual messages below the summary cards. Columns: patient name, template used, date/time, status (Badge semantic variant). The table supports pagination and includes a search input for filtering by patient name. Mobile view renders as stacked cards.

#### Scenario: Message table shows status badges

- **WHEN** the table displays messages with various statuses
- **THEN** each status renders with the appropriate Badge variant: "Enviada" (neutral), "Entregue" (info), "Lida" (success), "Falhou" (danger)

#### Scenario: Message table paginates

- **WHEN** psychologist has 150 messages in the selected period
- **THEN** the table paginates with page controls at the bottom

#### Scenario: Mobile renders messages as stacked cards

- **WHEN** psychologist views the history page on mobile (<768px)
- **THEN** the table transforms into stacked cards with patient name, template, date, and status badge

### Requirement: Cost estimation uses configurable template price

The system SHALL calculate estimated cost by multiplying the count of template messages (direction='outbound', template_key IS NOT NULL) by the env var `TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL` (default 0.10). The result is displayed formatted as Brazilian Real (e.g., "R$ 24,50").

#### Scenario: Cost calculated with default price

- **WHEN** psychologist sent 245 template messages in the period and `TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL=0.10`
- **THEN** estimated cost displays as "R$ 24,50"

#### Scenario: Cost calculated with custom price

- **WHEN** psychologist sent 100 template messages and `TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL=0.15`
- **THEN** estimated cost displays as "R$ 15,00"
