# homepage-faq (delta)

Aligns the FAQ section to its canonical Figma frames `125:2` (desktop 1440) and
`138:2` (mobile 375) in file `HoLOEqq9PXlo6IwLkz3FQ9`. Token values are the DS
variables read via `get_variable_defs` on those nodes.

## MODIFIED Requirements

### Requirement: FAQ accordion with required MVP questions

The system SHALL render a FAQ section titled "Ainda em dúvida? Comece por aqui."
(`Display/md` 32/40), followed by an accordion of between 5 and 8 questions built
from native `<details>/<summary>` elements. Each accordion item renders on
`surface` with `radius-xl` (12) and a `border`; an open item is indicated with a
`brand-200` border. The title is preceded by an uppercase eyebrow "PERGUNTAS
FREQUENTES" (`Label/caption-upper` 12/16 ls 6, `brand-700`) on **desktop only**
(`125:2`); the mobile frame (`138:2`) shows the title with NO eyebrow. The
question label and several question/answer strings use breakpoint variants drawn
in Figma:

- Desktop (`125:2`): question label `Body/lg` (17/28). Questions: (1) "Meus dados
  de paciente ficam seguros?" — answer verbatim "Sim. Os dados ficam em servidores
  no Brasil (São Paulo), com criptografia AES-256 em repouso e TLS 1.3 em trânsito.
  Você é a controladora dos dados; nós atuamos apenas como operadores, conforme a
  LGPD."; (2) "Funciona para atendimento presencial também?"; (3) "Preciso cancelar
  o Google Agenda?"; (4) "A IA vai errar e inventar conteúdo?"; (5) "Quanto custa
  depois do período grátis?".
- Mobile (`138:2`): question label at the smaller scale (`Body/base` 15 /
  `Heading/h4`). Condensed strings: (1) "Meus dados de paciente ficam seguros?" —
  condensed answer "Servidores no Brasil (São Paulo), AES-256 e TLS 1.3. Você é a
  controladora; nós, operadores, conforme a LGPD."; (2) "Funciona para presencial
  também?"; (3) "Preciso cancelar o Google Agenda?"; (4) "A IA inventa conteúdo?";
  (5) "Quanto custa depois do teste?".

Answer angles (both breakpoints): (2) sim; IA via upload do áudio; (3) não;
importação CSV, migração no próprio ritmo; (4) sugestão editável, nada salvo sem
revisão; (5) valores + link para `/precos`.

#### Scenario: FAQ shows the title and required questions, eyebrow desktop-only

- **WHEN** the FAQ section renders
- **THEN** it shows the title "Ainda em dúvida? Comece por aqui." and between 5 and 8 `<details>` items including the 5 required questions, each with a `<summary>` and an answer; the "PERGUNTAS FREQUENTES" eyebrow is present at 1440 and absent at 375

#### Scenario: Accordion item tokens match the Figma frames per breakpoint

- **WHEN** an FAQ item renders (closed) and is then opened
- **THEN** the closed item uses `surface` + `radius-xl` + `border` with the question in `Body/lg` at 1440 and the smaller `Body/base`/`Heading-h4` scale at 375, and the open item gains a `brand-200` border
