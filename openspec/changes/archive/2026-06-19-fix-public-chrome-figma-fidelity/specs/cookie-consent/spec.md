## MODIFIED Requirements

### Requirement: First-visit LGPD cookie consent banner

The system SHALL render a cookie consent banner on a visitor's first public visit (when no `cookie_consent` cookie is present), styled as a bottom card (`radius/2xl`, `Shadow/Light/lg`, max ~460px). It MUST contain: the title "Cookies por aqui"; the body text "Usamos cookies para melhorar sua experiência e medir o desempenho do site. Você escolhe."; a "Saiba mais na Política de Privacidade" link to `/politica-de-privacidade` positioned above the action buttons; an "Aceitar" primary button; and a "Recusar" secondary button.

#### Scenario: Banner shows on first visit

- **WHEN** a visitor with no `cookie_consent` cookie loads any public page
- **THEN** the banner renders with the "Cookies por aqui" title, the body text ending in "Você escolhe.", the "Saiba mais na Política de Privacidade" link to `/politica-de-privacidade`, and the "Aceitar"/"Recusar" buttons

#### Scenario: Banner is hidden once a choice exists

- **WHEN** a visitor already has a `cookie_consent` cookie (any value)
- **THEN** the banner does not render
