## MODIFIED Requirements

### Requirement: Login page exposes a Google sign-in entry point

The system SHALL render an "Entrar com Google" button on `/login` that initiates the OAuth flow via `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<origin>/auth/callback', queryParams: { prompt: 'select_account' } } })`. The button MUST live inside `LoginForm` and use the design system's secondary button variant; the click MUST call the Supabase client from a Client Component (no Server Action involved). The button MUST be positioned **above** the email/password fields ("Google-first"), with an "ou" divider separating it from the credential fields below it. The button MUST render the official multi-color Google "G" glyph; the glyph MUST keep Google's brand colors (it MUST NOT be recolored to `currentColor` or any single tone), per Google's brand guidelines.

#### Scenario: Click on Google button starts OAuth flow

- **WHEN** an unauthenticated user clicks the button on `/login`
- **THEN** the browser navigates to Google's consent screen for the configured client; on success Google redirects to `<origin>/auth/callback?code=…`

#### Scenario: Google button uses a stable test id

- **WHEN** the page is inspected
- **THEN** the button exposes `data-testid="login-form-google-button"` and renders the multi-color Google "G" glyph as an inline SVG

#### Scenario: Google button is positioned first

- **WHEN** `/login` is rendered
- **THEN** the Google button appears above the email and password fields, followed by an "ou" divider, then the credential fields and the submit button

## ADDED Requirements

### Requirement: Signup page exposes a Google sign-up entry point

The system SHALL render a "Cadastrar com Google" button on `/signup` that initiates the exact same OAuth flow as the login button via `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<origin>/auth/callback', queryParams: { prompt: 'select_account' } } })`. The button MUST reuse the shared `GoogleButton` Client Component (imported directly from its leaf component file, not via the `@/modules/oauth` barrel, so that server-only code is not dragged into the client bundle), MUST use the design system's secondary button variant, and MUST render the official multi-color Google "G" glyph with brand colors preserved. The button MUST be positioned **above** the signup form fields ("Google-first"), with an "ou" divider separating it from the fields below. Clicking it MUST NOT submit the signup form. No new backend, callback, or RLS behavior is introduced — a first-time Google user reaching `/auth/callback` is handled by the existing branching (profile completion at `/onboarding/complete-profile`; email collision at `/auth/link-account`).

#### Scenario: Click on Google button from signup starts OAuth flow

- **WHEN** an unauthenticated user clicks the "Cadastrar com Google" button on `/signup`
- **THEN** the browser navigates to Google's consent screen for the configured client; on success Google redirects to `<origin>/auth/callback?code=…` and is resolved by the existing callback branching

#### Scenario: Signup Google button uses a distinct, stable test id

- **WHEN** `/signup` is inspected
- **THEN** the button exposes `data-testid="signup-form-google-button"` (distinct from the login button's id) and renders the multi-color Google "G" glyph as an inline SVG

#### Scenario: Signup Google button is positioned first and does not submit the form

- **WHEN** `/signup` is rendered
- **THEN** the Google button appears above the name/email/password/CRP/consent fields, followed by an "ou" divider; the button is `type="button"` and clicking it does not trigger native signup form submission

#### Scenario: First-time Google sign-up from signup reuses the existing flow

- **WHEN** a user with no existing account signs up via the `/signup` Google button and consents
- **THEN** the existing `/auth/callback` branching sends them to `/onboarding/complete-profile` to provide CRP, UF, and the three LGPD consents, exactly as a Google sign-up initiated from `/login` would
