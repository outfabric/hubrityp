## MODIFIED Requirements

### Requirement: `/dashboard/transcricoes` lists transcriptions awaiting review

The system SHALL provide `/dashboard/transcricoes/page.tsx` (Server Component) rendering a list of the authenticated user's transcriptions, ordered by priority: pending review (`status='ready' AND saved_to_prontuario=false`) first, then `reviewed`, then `failed`. Tabs: `"Pendentes"`, `"Revisadas"`, `"Falhas"`. Each card shows: patient first name, session date, `template_used`, status badge, `"Ver"` link.

The page SHALL read `searchParams.status` on the server and resolve the initially active tab from it against a **closed allowlist**. In the MVP the only accepted value is `status=ready`, which SHALL select the `"Pendentes"` tab on the first server render (no flash of the default tab). Any other value — unknown (`?status=xyz`), empty, malformed, or array — SHALL be ignored and the page SHALL fall back to the default `"Pendentes"` tab with no error and no blank screen. The active tab MUST be decided server-side from `searchParams` so the correct segment is shown on first paint (the tab label itself is the visible filter indicator; no separate removable chip is required, since tab navigation already returns the user to the other segments). Allowlist validation runs on the server as defense against URL-injected filter values; it never widens the owner-scoping of the underlying query.

#### Scenario: Empty state
- **GIVEN** no transcriptions for the user
- **WHEN** the page loads
- **THEN** an empty state renders with `Sparkles` icon, headline `"Nenhuma transcrição ainda"`, body `"Quando você enviar um áudio de sessão, as notas geradas aparecerão aqui."`, primary CTA `"Ver pacientes"` (link to `/dashboard/pacientes`).

#### Scenario: Deep-link with status=ready opens the Pendentes tab
- **GIVEN** the authenticated user has transcriptions in more than one bucket
- **WHEN** the page loads at `/dashboard/transcricoes?status=ready`
- **THEN** the `"Pendentes"` tab is the active tab on the first render (server-resolved, no client flip)
- **AND** the pending-review rows (`status='ready' AND saved_to_prontuario=false`) are the visible segment

#### Scenario: Unknown status value degrades to the default tab
- **WHEN** the page loads at `/dashboard/transcricoes?status=xyz` (or `?status=` empty, or `status` repeated as an array)
- **THEN** the page renders the default `"Pendentes"` tab with no error thrown and no blank screen
- **AND** no filter outside the allowlist is applied

#### Scenario: Tab filtering
- **WHEN** the `"Revisadas"` tab is clicked
- **THEN** only `status='reviewed'` rows appear

#### Scenario: Anonymous redirect
- **WHEN** anonymous
- **THEN** middleware redirects to `/login`
