# account-registration Specification

## Purpose

Define the public registration surface of the platform: the `/signup` page, the `signUp` Server Action, the email verification callback, the `/onboarding/pending` screen that gates the `(app)` for not-yet-active accounts, the resend-verification action, and the canonical `getCurrentProfile` reader that joins the active Supabase session to a typed `profiles` row. Created by archiving change `auth-account-creation`.

## Requirements

### Requirement: Signup page is publicly reachable and renders the registration form

The system SHALL provide a `/signup` route under the `(auth)` route group that renders the full professional registration form for unauthenticated users. The page MUST be a Server Component that composes a `'use client'` form leaf, follow the design system tokens, and never render for users with an active session (the middleware redirects them).

#### Scenario: Anonymous user can reach `/signup`

- **WHEN** an anonymous client visits `/signup`
- **THEN** the response is HTTP 200 and the page renders inputs for full name, email, password, password confirmation, CRP number, CRP UF, and three required consent checkboxes (Terms, Privacy, Sensitive Data Treatment)

#### Scenario: Authenticated active user is redirected away from `/signup`

- **WHEN** a user whose `profile.status = 'active'` visits `/signup`
- **THEN** the middleware redirects them to `/dashboard`

#### Scenario: Authenticated pending user is redirected to onboarding

- **WHEN** a user whose `profile.status` is `pending_crp_validation` visits `/signup`
- **THEN** the middleware redirects them to `/onboarding/pending`

#### Scenario: Form fields use stable test ids

- **WHEN** the page is inspected
- **THEN** the inputs expose `data-testid="signup-form-name"`, `signup-form-email`, `signup-form-password`, `signup-form-password-confirm`, `signup-form-crp-number`, `signup-form-crp-uf`, the consent checkboxes expose `signup-form-terms`, `signup-form-privacy`, `signup-form-sensitive-data`, the submit button exposes `signup-form-submit`, and any inline error region exposes `signup-form-error`

### Requirement: Consent labels present informed-consent links to the legal pages

The `/signup` consent rows SHALL render each of the three LGPD consent labels as *informed*
consent: the anchor words of every label MUST be a link to the corresponding public legal page,
opening in a new browser tab so the in-progress form state is preserved. The three flags remain
required (`z.literal(true)`); this requirement governs presentation only and MUST NOT alter the
validation, submission, testids, or error wiring defined by the existing signup requirements.

The label-to-link mapping SHALL be:

| Consent field | Anchor text (link) | `href` |
|---|---|---|
| `acceptedTerms` | Termos de Uso | `/termos-de-uso` |
| `acceptedPrivacy` | Política de Privacidade | `/politica-de-privacidade` |
| `acceptedSensitiveData` | dados sensíveis conforme a LGPD | `/politica-de-privacidade#lgpd` |

Each label's sentence MUST remain coherent when the link text is read as plain text (screen
reader friendliness), e.g. "Li e aceito os **Termos de Uso**".

#### Scenario: Each consent label renders a link to its legal page

- **WHEN** the signup form is rendered and the three consent rows are inspected
- **THEN** the `acceptedTerms` label contains an anchor with `href="/termos-de-uso"`, the `acceptedPrivacy` label contains an anchor with `href="/politica-de-privacidade"`, and the `acceptedSensitiveData` label contains an anchor with `href="/politica-de-privacidade#lgpd"`

#### Scenario: Consent links open in a new tab without reverse-tabnabbing

- **WHEN** any of the three consent-label anchors is inspected
- **THEN** the anchor has `target="_blank"` and `rel` containing `noopener` and `noreferrer`

#### Scenario: Activating a consent link does not toggle the checkbox

- **WHEN** the user clicks (or activates via keyboard) the link inside a consent label while that checkbox is unchecked
- **THEN** the linked legal page opens and the checkbox remains unchecked (reading is decoupled from accepting)

#### Scenario: Clicking the checkbox still toggles consent

- **WHEN** the user clicks the checkbox control of a consent row
- **THEN** the corresponding consent flag toggles and RHF validation runs as before, unchanged from the pre-existing behavior

#### Scenario: Consent links are distinguishable without relying on color

- **WHEN** a consent-label link is rendered
- **THEN** it carries an underline (not color alone) and inherits the design-system focus-visible ring, and its brand link color meets WCAG AA contrast (≥ 4.5:1) against the card background

#### Scenario: Consent testids and acceptance validation are unchanged

- **WHEN** the signup form is submitted with all three consents checked, and separately with any one left unchecked
- **THEN** the checkboxes still expose `data-testid="signup-form-terms"`, `signup-form-privacy`, `signup-form-sensitive-data`; the all-checked submit succeeds and the one-unchecked submit surfaces the existing per-field consent error — identical to behavior before this change

### Requirement: `signupInputSchema` validates every field according to PRD 01

The system SHALL define `signupInputSchema` (Zod) as the single source of truth for both server-side validation in the `signUp` Server Action and client-side validation in the signup form. The schema MUST enforce: full name length 3–120, RFC 5322 email, password meeting the strong-password policy (Requirement: "Password policy enforces strong passwords"), password confirmation equality, CRP number matching `^\d{2}/\d{4,7}$`, CRP UF in the closed set of 27 Brazilian UFs, CRP regional code consistent with UF (Apêndice A do PRD), and all three consent flags set to `true`.

#### Scenario: Schema accepts a fully valid payload

- **WHEN** `signupInputSchema.safeParse({ fullName: 'Maria Silva', email: 'maria@ex.com', password: 'Forte!Senha9', passwordConfirm: 'Forte!Senha9', crpNumber: '06/123456', crpUf: 'SP', acceptedTerms: true, acceptedPrivacy: true, acceptedSensitiveData: true })` runs
- **THEN** the result has `success: true`

#### Scenario: Schema rejects mismatched password confirmation

- **WHEN** the parser is called with `password: 'Forte!Senha9'` and `passwordConfirm: 'Outra!Senha9'`
- **THEN** the result has `success: false` with an error keyed on `passwordConfirm`

#### Scenario: Schema rejects CRP regional code inconsistent with UF

- **WHEN** the parser is called with `crpNumber: '06/123456'` and `crpUf: 'RJ'` (06 is reserved for SP)
- **THEN** the result has `success: false` with an error pointing at `crpNumber` or `crpUf` and a message that explains the mismatch in pt-BR

#### Scenario: Schema rejects malformed CRP number

- **WHEN** the parser is called with `crpNumber: '6/12345'` or `'06-123456'` or `'06/12'`
- **THEN** the result has `success: false` with an error on `crpNumber`

#### Scenario: Schema rejects unknown UF

- **WHEN** the parser is called with `crpUf: 'XX'`
- **THEN** the result has `success: false` with an error on `crpUf`

#### Scenario: Schema rejects missing consents

- **WHEN** the parser is called with any of `acceptedTerms`, `acceptedPrivacy`, `acceptedSensitiveData` set to `false`
- **THEN** the result has `success: false` with errors on each missing consent field

#### Scenario: Schema rejects names outside the 3–120 character window

- **WHEN** the parser is called with `fullName: 'AB'` or a 121-character string
- **THEN** the result has `success: false` with an error on `fullName`

### Requirement: Password policy enforces strong passwords on signup

The system SHALL enforce, on signup only, a password policy of at least 10 characters containing at least one uppercase letter, one lowercase letter, one digit, and one special character from the set `!@#$%^&*()_+\-=[\]{}|;:,.<>?`. The policy MUST be implemented as a pure function `passwordPolicy(s: string): { ok: boolean; missing: PasswordRule[] }` reusable by both UI feedback and Zod refinement, where `PasswordRule` is one of `'length' | 'uppercase' | 'lowercase' | 'digit' | 'special'`.

#### Scenario: Strong password passes

- **WHEN** `passwordPolicy('Forte!Senha9')` is called
- **THEN** the result is `{ ok: true, missing: [] }`

#### Scenario: Short password reports missing length

- **WHEN** `passwordPolicy('Forte!9')` is called
- **THEN** the result is `{ ok: false, missing: ['length'] }`

#### Scenario: Password missing every class reports them all

- **WHEN** `passwordPolicy('aaaaaaaaaa')` is called
- **THEN** the result is `{ ok: false, missing: ['uppercase', 'digit', 'special'] }` (length is satisfied)

#### Scenario: Login schema is unchanged by this policy

- **WHEN** the existing `loginInputSchema.safeParse({ email: 'a@b.co', password: '12345678' })` runs (8 characters, no class requirements)
- **THEN** the result has `success: true` because the strong policy applies to signup only

### Requirement: `signUp` Server Action creates account and dispatches verification email

The system SHALL implement a Server Action `signUp(formData)` exposed at `app/(auth)/signup/actions.ts` (`'use server'` shell delegating to `@/modules/registration`). The action MUST validate input via `signupInputSchema`, call `supabase.auth.signUp` with the verified payload, and rely on the database trigger (Requirement: "Database trigger creates `profiles` row on `auth.users` insert" in `data-layer`) to materialize `profiles` with `status = 'pending_verification'`. Because Supabase email confirmation is enabled, `supabase.auth.signUp` returns NO session; the just-registered client is therefore anonymous. On success, the action MUST log a `signup_success` event, set the signed `pending-email` cookie (see `public-email-confirmation` spec), and redirect to the public `/verifique-email` page (NOT the session-gated `/onboarding/pending`, which an anonymous request cannot reach). On failure, the action MUST return a typed result and NEVER throw across the boundary.

#### Scenario: Valid payload succeeds and redirects to the public confirmation page

- **WHEN** the form is submitted with input that passes `signupInputSchema` and Supabase accepts the signup
- **THEN** the action calls `supabase.auth.signUp({ email, password, options: { data: { fullName, crpNumber, crpUf, acceptedTerms, acceptedPrivacy, acceptedSensitiveData }, emailRedirectTo: '<origin>/auth/callback' } })`, logs `signup_success` in `auth_logs` with `metadata: { crpNumber, crpUf }`, sets the signed `pending-email` cookie, and redirects the browser to `/verifique-email`

#### Scenario: Invalid payload is rejected before calling Supabase

- **WHEN** the form is submitted with any field failing `signupInputSchema`
- **THEN** the action returns `{ ok: false, error: 'invalid_input', fieldErrors: { ...flatErrors } }` without calling Supabase or writing to the database

#### Scenario: Duplicate email returns typed error and logs the failure

- **WHEN** Supabase responds with "User already registered"
- **THEN** the action returns `{ ok: false, error: 'duplicate_email' }`, logs `signup_failure_duplicate_email` in `auth_logs` with `user_id: null` and `metadata.emailHash`, does not set the `pending-email` cookie, and does not redirect

#### Scenario: Duplicate CRP/UF rolls back the auth.user and returns typed error

- **WHEN** Supabase signup succeeds but the trigger detects a `UNIQUE (crp_number, crp_uf)` violation
- **THEN** the action invokes `supabase.auth.admin.deleteUser(userId)` via the service-role client, logs `signup_failure_duplicate_crp` in `auth_logs` with `metadata.crpNumber` and `metadata.crpUf`, and returns `{ ok: false, error: 'duplicate_crp' }`

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs (Supabase 5xx, network, database unreachable)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception to the client

### Requirement: Email verification callback transitions account status

The system SHALL provide a Route Handler at `src/app/(auth)/auth/callback/route.ts` (resolves to `/auth/callback`) that exchanges the Supabase verification code for a session via `supabase.auth.exchangeCodeForSession`, relies on the database trigger to transition `profile.status` from `pending_verification` to `pending_crp_validation`, logs an `email_verified` event, and redirects to `/onboarding/pending`. On error (expired or invalid token), the route MUST render a friendly error page with an action to resend the verification email.

#### Scenario: Valid verification code transitions status and redirects

- **WHEN** the user clicks a valid verification link and the GET request hits `/auth/callback?code=<valid>`
- **THEN** the handler calls `exchangeCodeForSession`, the trigger has already updated `profile.status = 'pending_crp_validation'` (or does so as part of the same transaction), the handler logs `email_verified` in `auth_logs`, and the response is HTTP 307 to `/onboarding/pending`

#### Scenario: Expired or invalid code shows recoverable error

- **WHEN** the GET request hits `/auth/callback?code=<expired or tampered>`
- **THEN** the handler renders an error page with `data-testid="auth-callback-error"` containing a "Reenviar email de verificação" button (`data-testid="auth-callback-resend"`) and pt-BR copy that explains the link expired

#### Scenario: Missing code parameter renders error

- **WHEN** the GET request hits `/auth/callback` without a `code` query parameter
- **THEN** the handler renders the same error page (does not crash)

### Requirement: Onboarding pending screen blocks `(app)` until profile is active

The system SHALL provide an `/onboarding/pending` page under the `(app)` route group that renders a centered card explaining the current account status. The page serves exclusively users in `pending_crp_validation` — the post-confirmation state in which a valid session exists. Users in `pending_verification` never hold a session (signup returns none and login is blocked), so they are routed to the public `/verifique-email` page instead and never reach this screen. Any attempt to access another `(app)` route while in `pending_crp_validation` MUST be redirected to `/onboarding/pending` by the middleware. The screen MUST render a read-only message about the CRP validation queue and MUST NOT render a verification-email resend control (email confirmation is already complete in this state). An `active` user reaching `/onboarding/pending` MUST be redirected to `/dashboard`.

#### Scenario: `pending_crp_validation` user sees waiting message

- **WHEN** a user with `profile.status = 'pending_crp_validation'` visits `/onboarding/pending`
- **THEN** the page renders the card with copy explaining the CRP validation queue and the expected SLA (24h), without any resend button

#### Scenario: Active user is redirected to dashboard

- **WHEN** a user with `profile.status = 'active'` visits `/onboarding/pending`
- **THEN** the middleware redirects them to `/dashboard` (HTTP 307)

#### Scenario: No session resolves to login (defense-in-depth)

- **WHEN** a request reaches `/onboarding/pending` with no session or no `profiles` row
- **THEN** the page redirects to `/login` (the middleware is the authoritative gate; this re-check guards against bypass)

#### Scenario: Pending-CRP user attempting `/dashboard` is redirected to onboarding

- **WHEN** a user with `profile.status = 'pending_crp_validation'` visits `/dashboard` or any other `(app)` route except `/onboarding/pending`
- **THEN** the middleware redirects them to `/onboarding/pending` (HTTP 307)

### Requirement: `getCurrentProfile` is the canonical profile loader for server contexts

The system SHALL provide `getCurrentProfile(supabase): Promise<Profile | null>` exposed by `@/modules/registration`. It MUST be the only function that joins the active Supabase session to a typed `profiles` row. RSC pages, layouts, Server Actions, and the middleware MUST consume profile data through this function to keep status-aware behavior consistent.

#### Scenario: Returns the typed profile for the active session

- **WHEN** the function is called with a Supabase server client tied to an authenticated user
- **THEN** it returns a `Profile` object whose fields include `userId`, `fullName`, `email`, `status`, `crpNumber`, `crpUf`, `emailVerifiedAt`, `crpValidatedAt`, `createdAt`, `updatedAt`

#### Scenario: Returns null when there is no session

- **WHEN** the function is called with a Supabase client whose `getUser()` returns `null`
- **THEN** the function returns `null` without throwing

#### Scenario: Returns null when the auth user has no profile row yet

- **WHEN** the function is called for an authenticated user whose `profiles` row does not exist (race window before trigger commits)
- **THEN** the function returns `null` (callers handle this as "treat like anonymous" for redirect logic)

### Requirement: `registration` module follows the standard module layout

The system SHALL place all registration code under `src/modules/registration/` with the following layout:

- `components/` — React components owned by the domain (Server and Client Components, including `signup-form.tsx` and `onboarding-pending-card.tsx`)
- `server/` — Server Action implementations and other server-only logic (`sign-up.ts`, `resend-verification.ts`, `get-profile.ts`)
- `lib/` — pure helpers and Zod schemas (`signup-input-schema.ts`, `password-validators.ts`, `crp-validators.ts`, `uf-table.ts`, `profile-status.ts`)
- `index.ts` — public API exporting `signUp`, `resendVerificationEmail`, `getCurrentProfile`, `signupInputSchema`, `passwordPolicy`, `SignupForm`, `OnboardingPendingCard`, `Profile`, `ProfileStatus`

The module MUST NOT carry `'use server'` at the barrel level (only the route shells under `app/` do). External consumers MUST import from `@/modules/registration`, never from internal paths.

#### Scenario: Public API is the only legal import surface

- **WHEN** any file outside `src/modules/registration/` needs `signUp` or `SignupForm`
- **THEN** it imports from `@/modules/registration` (the module's `index.ts`), not from `@/modules/registration/server/sign-up` or `@/modules/registration/components/signup-form`

#### Scenario: Module barrel does not declare `'use server'`

- **WHEN** a contributor reads `src/modules/registration/index.ts`
- **THEN** the file does not contain the `'use server'` directive (so re-exports of pure helpers, schemas, and Client Components remain valid in client bundles)

#### Scenario: Route shells delegate Server Actions

- **WHEN** a contributor reads `src/app/(auth)/signup/actions.ts`
- **THEN** the file declares `'use server'` and re-exports `signUp` (and `resendVerificationEmail` where mounted) as a thin wrapper around `@/modules/registration`

### Requirement: New `data-testid` values are documented in the convention doc

The system SHALL update `docs/design-system/testid.md` to register every new `data-testid` introduced by this change under a "Wave-4 IDs (auth-account-creation)" section. Each entry MUST include the testid, the file path, and a one-line description.

#### Scenario: Documentation lists all new IDs

- **WHEN** the change merges
- **THEN** `docs/design-system/testid.md` contains entries for `signup-form-name`, `signup-form-email`, `signup-form-password`, `signup-form-password-confirm`, `signup-form-crp-number`, `signup-form-crp-uf`, `signup-form-terms`, `signup-form-privacy`, `signup-form-sensitive-data`, `signup-form-submit`, `signup-form-error`, `onboarding-pending-status`, `onboarding-pending-resend-email`, `auth-callback-error`, `auth-callback-resend`

#### Scenario: Code-reviewer enforces the doc update

- **WHEN** a contributor adds a new `data-testid` without updating `docs/design-system/testid.md` in the same PR
- **THEN** the `code-reviewer` agent flags the PR with a `BLOCKER` issue
