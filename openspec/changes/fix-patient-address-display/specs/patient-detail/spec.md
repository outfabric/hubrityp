## MODIFIED Requirements

### Requirement: Visão geral shows patient overview

The system SHALL display the address in the "Visão geral" tab as a formatted human-readable string following the Brazilian address convention: `street, number, complement - neighborhood - city, state zipCode`. Missing parts SHALL be omitted without leaving dangling separators. If all address fields are empty or the stored value is unparseable, the field SHALL display `'-'`.

#### Scenario: Full address renders formatted

- **WHEN** patient has address `{"street":"Rua Exemplo","number":"123","complement":"Apto 4","neighborhood":"Centro","city":"São Paulo","state":"SP","zipCode":"01001-000"}`
- **THEN** the "Endereço" field displays "Rua Exemplo, 123, Apto 4 - Centro - São Paulo, SP 01001-000"

#### Scenario: Partial address omits missing parts

- **WHEN** patient has address `{"street":"Av. Brasil","number":"500","city":"Campinas","state":"SP"}`
- **THEN** the "Endereço" field displays "Av. Brasil, 500 - Campinas, SP"

#### Scenario: Empty or null address shows dash

- **WHEN** patient has address as `null` or `"{}"`
- **THEN** the "Endereço" field displays "-"

#### Scenario: Corrupted JSON shows dash

- **WHEN** patient has address as an unparseable string
- **THEN** the "Endereço" field displays "-"

#### Scenario: PDF export uses same formatted address

- **WHEN** psychologist exports a patient PDF for a patient with a stored address
- **THEN** the PDF "Endereço" field displays the same formatted string as the overview tab
