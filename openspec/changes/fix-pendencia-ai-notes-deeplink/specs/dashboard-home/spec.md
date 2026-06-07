## MODIFIED Requirements

### Requirement: Seção Pendências shows only MVP pendências
The system SHALL show, in Seção Pendências, exactly these MVP pendência types: (a) evoluções em atraso — count of `done` sessions older than 7 days with no evolution recorded, linking to a filtered agenda view; (b) patients without `consent_signed_at`, linking to a filtered `/pacientes` view; (c) AI transcription notes awaiting review (count), linking to the review screen. When there are no pendências, it MUST show a discreet "Tudo em dia." The section MUST NOT display any post-MVP pendência (Receita Saúde, cobranças, WhatsApp).

The deep-link hrefs emitted by `get-pendencias.ts` are the canonical, static, server-owned navigation contract for each pendência (no client input is ever interpolated into them). Each href MAY carry a single allowlisted filter parameter that its destination interprets. The contract is:

| Pendência | Constant | Canonical href |
|---|---|---|
| Evoluções em atraso | `OVERDUE_EVOLUTIONS_HREF` | `/agenda?filtro=sem-evolucao` |
| Pacientes sem consentimento | `PATIENTS_MISSING_CONSENT_HREF` | `/pacientes?filtro=sem-consentimento` |
| Notas de IA para revisar | `AI_NOTES_AWAITING_REVIEW_HREF` | `/dashboard/transcricoes?status=ready` |

The AI-notes href MUST resolve to an **existing** route. It SHALL be `/dashboard/transcricoes?status=ready` and MUST NOT point at `/configuracoes/ia/transcricoes` (a route that does not exist).

#### Scenario: Overdue evolutions are counted and linked
- **GIVEN** the psychologist has 2 `done` sessions older than 7 days with no evolution
- **WHEN** the Pendências section renders
- **THEN** it shows "2 sessões sem evolução" with a "Ver" link to the filtered agenda (`/agenda?filtro=sem-evolucao`)

#### Scenario: AI notes pendência links to the real transcriptions route
- **GIVEN** the psychologist has at least 1 AI transcription note with `status = 'ready'`
- **WHEN** the Pendências section renders
- **THEN** the AI-notes "Ver" link href equals `/dashboard/transcricoes?status=ready`
- **AND** the href MUST NOT contain `/configuracoes/ia/transcricoes`

#### Scenario: No pendências shows the positive state
- **GIVEN** the psychologist has zero overdue evolutions, zero patients missing consent, and zero AI notes pending
- **WHEN** the Pendências section renders
- **THEN** it shows "Tudo em dia." and occupies minimal space

#### Scenario: Post-MVP pendências never appear
- **WHEN** the Pendências section renders for any psychologist
- **THEN** the rendered text contains none of: "Receita Saúde", "cobrança", "WhatsApp"
