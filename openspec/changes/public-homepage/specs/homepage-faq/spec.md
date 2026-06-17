## ADDED Requirements

### Requirement: FAQ accordion with required MVP questions

The system SHALL render a FAQ section with between 5 and 8 questions in an accordion built from native `<details>/<summary>` elements. The MVP MUST include these 5 questions (with answers in the documented angle): (1) "Meus dados de paciente ficam seguros?" (São Paulo, AES-256, LGPD; psicóloga é controladora, nós operadores); (2) "Funciona para atendimento presencial também?" (sim; IA via upload do áudio); (3) "Preciso cancelar o Google Agenda?" (não; importação CSV, migração no próprio ritmo); (4) "A IA vai errar e inventar conteúdo?" (sugestão editável; nada salvo sem revisão); (5) "Quanto custa depois do período grátis?" (valores + link para `/precos`).

#### Scenario: FAQ shows the required questions

- **WHEN** the FAQ section renders
- **THEN** it shows between 5 and 8 `<details>` items including the 5 required questions, each with a `<summary>` and an answer

### Requirement: Exclusive accordion behavior with no-JS fallback

Opening one FAQ item SHALL close the previously open item (exclusive accordion). An open item is visually indicated (e.g. `brand/200` border). With JavaScript disabled, all items render in the expanded state (native `<details>` open) so all answers are readable.

#### Scenario: Opening an item closes the previous one

- **WHEN** one FAQ item is open and the user opens another
- **THEN** the first item collapses and only the newly opened item remains expanded

#### Scenario: All answers readable without JS

- **WHEN** JavaScript is disabled
- **THEN** every `<details>` item renders expanded so all answers are visible

#### Scenario: FAQ is keyboard accessible

- **WHEN** a keyboard user tabs to a `<summary>` and presses Enter/Space
- **THEN** the corresponding item toggles open/closed with a visible focus state
