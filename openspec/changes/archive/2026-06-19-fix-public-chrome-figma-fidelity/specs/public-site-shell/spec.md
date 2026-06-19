## MODIFIED Requirements

### Requirement: Public 404 page

The system SHALL provide a public `not-found.tsx` for the `(public)` group that renders a DS-consistent 404 screen: a large "404" in `brand/600`, the headline "Não encontramos esta página.", a message ("O endereço pode ter mudado ou não existe mais. Vamos te levar de volta ao começo."), and two CTAs in left-to-right visual order — a secondary "Voltar para a homepage" → `/` followed by a primary "Criar conta grátis" → `/signup` — wrapped in the public header/footer.

#### Scenario: Unknown public URL renders the 404

- **WHEN** an anonymous client requests a non-existent path such as `/funcionalidades`
- **THEN** the response status is 404, the page renders the "404" numeral and the "Não encontramos esta página." headline, the "Voltar para a homepage" link to `/`, and the "Criar conta grátis" link to `/signup`

#### Scenario: 404 is reachable without authentication

- **WHEN** an anonymous client requests an unknown public path
- **THEN** the middleware does not redirect to `/login` and the 404 page renders directly
