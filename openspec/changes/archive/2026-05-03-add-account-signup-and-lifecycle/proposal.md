E ## Why

The product can only legally serve psicólogos brasileiros registered with a CRP — Resolução CFP nº 09/2024 makes verified registration a hard prerequisite for handling clinical data, and LGPD art. 11 makes the same patient data sensitive. Today the platform exposes a `/login` route but has no signup surface, no way to capture the LGPD consents the cadastro must record, and no account state machine to gate access until the psicóloga's CRP is validated. PRD 01 closes that gap so the rest of the platform (pacientes, agenda, prontuário) has an `active` user to attach data to.

## What Changes

- Add a public `/signup` route with full PRD-01 form (name, email, password with complexity, CRP number + UF, three LGPD consent checkboxes) implemented as a Server Component shell + Client Component form, mirroring the existing `/login` shell↔module split.
- Add a `signUp` Server Action that creates a Supabase Auth user, persists the psychologist profile (CRP/UF/full name), records LGPD consent timestamps, transitions the account to `pending_verification`, and triggers the Supabase email verification flow.
- Add an `/auth/callback` route that consumes the Supabase verification link and advances the account state to `pending_crp_validation`.
- Add a "verify your email" bloqueante page rendered when an authenticated user has `status='pending_verification'`, and a "your CRP is being reviewed" bloqueante page when `status='pending_crp_validation'`.
- Introduce an account state machine with statuses `pending_verification → pending_crp_validation → active`, plus terminal/admin states `suspended` and `cancelled`. Transitions are encoded as a typed helper, not free-form updates.
- Capture the CRP regional codes table (Apêndice A of PRD 01) as a typed enum/helper and validate the `XX/NNNNNN` format at the Zod boundary; defer the network lookup against the CFP and instead enqueue the cadastro for manual admin review (the PRD's documented fallback when CFP has no stable API).
- **MODIFIED**: `signIn` no longer redirects every successful login to `/dashboard` — it now redirects based on account status (verification page → CRP review page → dashboard) so the middleware does not need to special-case suspended/cancelled accounts after the cookie is set.
- **MODIFIED**: middleware (root `middleware.ts`) gates `(app)` routes not just by "has session" but by `status === 'active'` — `pending_*` users are forced onto their bloqueante page; `suspended`/`cancelled` are signed out and shown a terminal message.
- Schema additions in `src/shared/db/schema/auth/`: a new `psychologist_profiles` table (CRP number, UF, full name, status, consent timestamps, FK → `auth.users`) and a `crp_validation_queue` table for the manual review flow. RLS policies restrict reads to the owning user (and a future admin role for the queue).

**Out of scope (deferred to a follow-up change):** Google OAuth login, password reset email flow, login attempt rate limiting + lockout, refresh-token "manter conectado" behavior. These are tracked as PRD-01 items but split off so the foundational signup + lifecycle merges first.

## Capabilities

### New Capabilities

- `account-lifecycle`: Account status state machine (`pending_verification`, `pending_crp_validation`, `active`, `suspended`, `cancelled`), transition helpers, status-aware gating used by middleware and route shells, LGPD consent capture (terms / privacy / sensitive-data), and `psychologist_profiles` schema with RLS.
- `crp-validation`: CRP number format validation (regex + regional code table from Apêndice A of PRD 01), the manual review queue (`crp_validation_queue`) and the admin-side approve/reject transitions that emit account-lifecycle events. The eventual automated CFP lookup will be added to this capability later.

### Modified Capabilities

- `authentication`: Adds the `/signup` route, the `signUp` Server Action with stronger password complexity (RF-01.04: 10 chars + classes), the `signupInputSchema` Zod validator covering name/CRP/UF/consents, status-aware redirect from `signIn`, and middleware gating by `account-lifecycle` status (not just session presence).

## Impact

- **Code**: new module `src/modules/account-lifecycle/`, new module `src/modules/crp-validation/`, extension of `src/modules/auth/` (signup form, signupInputSchema, signUp action, status-aware safeRedirect helper). New route shells `src/app/(auth)/signup/`, `src/app/(auth)/auth/callback/`, `src/app/(app)/_status/{verify-email,crp-review}/`. Middleware extended to call a new `getAccountStatus` helper.
- **Schema**: new tables `psychologist_profiles` and `crp_validation_queue` in `src/shared/db/schema/auth/`. Drizzle migration generated and applied via `npm run db:migrate`. RLS policies enforced from migration.
- **Dependencies**: Resend (or Supabase's built-in transactional email) for the verification mail; no new npm packages — Supabase Auth already handles password hashing (Argon2id) and email verification token issuance, so RNF-01.01 is satisfied without adding bcrypt/argon2 directly.
- **Security**: Server Actions validate via Zod and authorize from session (never from form input). The `crp_validation_queue` row carries no card photo (RN-01.05) — admins see only the declared CRP/UF/name and can mark approve/reject; the photo upload flow is explicitly deferred. Logs (existing pino logger) emit `signup_*` and `crp_validation_*` events without ever logging password/email content beyond hashed IDs.
- **LGPD**: the three consent checkboxes are persisted as separate timestamps so an audit query can prove which version of which document the user accepted at signup. PRD 11 (anonymization) will later read these.
- **Tests**: unit (schemas, state-machine helper, CRP regex), integration (signUp action against real Postgres + Supabase local, status transitions, middleware gating), e2e seeded (full signup → verify email → blocked CRP review → admin approves → dashboard).
- **Docs**: new `docs/account-lifecycle.md` and `docs/crp-validation.md`; `docs/authentication.md` updated with the new signup surface and status-aware gating.
