## ADDED Requirements

### Requirement: Public `/verifique-email` page is reachable without a session

The system SHALL provide a public `/verifique-email` route that renders for unauthenticated clients (the just-signed-up, not-yet-confirmed psychologist). The page MUST be a Server Component that follows the Design System (`docs/design-system/rules.md`): a single `Card` (`default` variant, radius `xl`, padding `space-6`, no nested cards), Inter typography, brand color limited to the primary action and focus ring, the `Mail` Lucide icon (`aria-hidden`), pt-BR microcopy, dark-mode tokens, and WCAG 2.1 AA contrast/focus. The page MUST NOT require or assume a session, MUST NOT read any session cookie, and MUST NOT crash when no pending-email context exists.

The card MUST render the agreed pt-BR copy: a title and a body explaining "Confirme seu cadastro, através de um link que enviamos para seu email. Se não encontrar, busque na caixa de Spam ou Lixeira.", the user's masked email when available, and a resend control.

#### Scenario: Anonymous client reaches the page

- **WHEN** an anonymous client requests GET `/verifique-email`
- **THEN** the response is HTTP 200, the page renders the confirmation card, and there is no redirect to `/login`

#### Scenario: Page exposes stable test ids

- **WHEN** the page is inspected
- **THEN** the card exposes `data-testid="verifique-email-card"`, the masked-email element exposes `data-testid="verifique-email-address"`, the resend control exposes `data-testid="verifique-email-resend"`, and the resend feedback region exposes `data-testid="verifique-email-feedback"` with `aria-live="polite"`

#### Scenario: Page renders without a pending-email cookie

- **WHEN** an anonymous client requests `/verifique-email` with no (or an invalid) pending-email cookie
- **THEN** the page still returns HTTP 200 and renders the generic confirmation guidance and the resend control, omitting only the masked-email line (no error, no crash)

#### Scenario: Design System compliance

- **WHEN** the page renders
- **THEN** it uses only Design System tokens (no hardcoded colors, no gradients/blur/glow), keeps a single heading hierarchy, renders correctly at 375px width and at 200% zoom, and respects `prefers-reduced-motion`

### Requirement: Signed `pending-email` cookie carries the email server-side

The system SHALL carry the pending confirmation email in a short-lived, integrity-protected cookie named `pending-email` rather than in the URL. The cookie value MUST be HMAC-signed with a server-side secret so a tampered value is rejected and treated as absent. The cookie MUST be `HttpOnly`, `SameSite=Lax`, `Secure` in production, scoped to `Path=/`, and expire within a short window (≤ 30 minutes). The email MUST NEVER appear as a query-string parameter (`?email=`) or in any client-visible URL, log line, or referrer.

The cookie MUST be set by the `signUp` Server Action on successful signup and by the `signIn` Server Action when Supabase returns `email_not_confirmed`. Server contexts (the `/verifique-email` page and the public resend action) read and verify it via the request cookie store.

#### Scenario: Cookie is set with hardened attributes

- **WHEN** `signUp` succeeds (or `signIn` returns `email_not_confirmed`)
- **THEN** the response sets a `pending-email` cookie that is `HttpOnly`, `SameSite=Lax`, `Secure` (in production), `Path=/`, carries an HMAC signature over the email, and expires within the short window

#### Scenario: Tampered cookie is rejected

- **WHEN** the `/verifique-email` page or the resend action receives a `pending-email` cookie whose signature does not verify
- **THEN** the value is treated as absent (no masked email rendered, resend performs the no-cookie path) and no error is surfaced

#### Scenario: Email is never exposed in the URL

- **WHEN** a user is redirected to `/verifique-email` after signup or unconfirmed login
- **THEN** the destination URL contains no email or other PII as a query parameter

### Requirement: Masked email is rendered for human reassurance only

The system SHALL render the pending email in a masked form derived from the verified `pending-email` cookie — preserving the first character of the local part and the full domain (e.g. `m****@gmail.com`) — so the user can confirm which inbox to check without exposing the full address in the DOM.

#### Scenario: Email is masked

- **WHEN** the page renders with a valid `pending-email` cookie for `maria.silva@gmail.com`
- **THEN** the `verifique-email-address` element shows a masked value such as `m**********@gmail.com` and never the full local part

### Requirement: Anonymous resend is enumeration-safe and Supabase-rate-limited

The system SHALL provide a public resend action, reachable from `/verifique-email` without a session, that resends the signup confirmation email. The action MUST take the target email from the verified `pending-email` cookie — NEVER from client-supplied input — so a caller cannot trigger emails to arbitrary addresses or probe which addresses are registered. The action MUST call `supabase.auth.resend({ type: 'signup', email })`, rely on Supabase's native limits (per-user 60-second window plus the project-wide per-hour email-send limit), and MUST NOT implement account lookups. The action MUST be enumeration-safe: it MUST return the SAME generic, success-shaped result and render the SAME pt-BR copy regardless of the Supabase outcome (200 success, 422 user-not-found, or 429 rate-limited), and MUST NEVER throw across the boundary.

#### Scenario: Resend with a valid cookie

- **WHEN** the user clicks resend on `/verifique-email` and a valid `pending-email` cookie is present
- **THEN** the action calls `supabase.auth.resend({ type: 'signup', email: <cookie email> })` and renders generic pt-BR confirmation copy (e.g. "Se houver um cadastro com este email, reenviamos o link de confirmação.")

#### Scenario: Resend is rate-limited by Supabase

- **WHEN** Supabase responds with HTTP 429 / `over_email_send_rate_limit`
- **THEN** the action renders the SAME generic confirmation copy (no distinct "rate limited" wording that would confirm the address exists) and does not throw

#### Scenario: Resend with no valid cookie does not call Supabase

- **WHEN** the resend action runs with no (or a tampered) `pending-email` cookie
- **THEN** the action does NOT call `supabase.auth.resend`, performs no account lookup, and renders the SAME generic confirmation copy

#### Scenario: Resend never branches copy on account existence

- **WHEN** the Supabase outcome is success (200) versus user-not-found (422)
- **THEN** the rendered copy and the returned result shape are identical in both cases

### Requirement: Confirm-email copy is shared between the public page and the login page

The system SHALL define the "confirme seu email" pt-BR message once and reuse it on both the `/verifique-email` page and the login page's `email_not_confirmed` state, so the user sees consistent guidance wherever they encounter the unconfirmed-account condition. The shared copy MUST follow the Design System microcopy tone (direct, human, no emojis).

#### Scenario: Login surfaces the same message

- **WHEN** the login page renders the `email_not_confirmed` state (see `authentication` spec) and the `/verifique-email` page renders its body
- **THEN** both display the same confirm-email guidance text from the single shared source
