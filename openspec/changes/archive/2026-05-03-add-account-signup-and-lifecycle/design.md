## Context

The existing `authentication` capability covers `/login`, `/signOut`, and middleware that gates `(app)` routes by session presence. There is no signup, no profile, no LGPD consent capture, and no notion of an "account that has a session but is not yet allowed to use the product." PRD 01 turns those gaps into a hard product requirement: a Brazilian psychologist must register with a CRP, accept three LGPD documents, verify their email, and have their CRP cross-checked before they can create patients or schedule sessions (which downstream PRDs depend on).

Two adjacent constraints shape this design:

1. **CFP has no stable public API for CRP lookup.** PRD 01 §5.1 RF-01.05 explicitly authorizes a manual fallback ("validação humana com SLA de 24h"). Building automated lookup right now would couple us to a flaky public site and slow down the MVP. We will model the manual flow as the primary path and leave room for an automated lookup later inside the same `crp-validation` capability.
2. **Supabase Auth is the password store, not us.** Supabase already runs Argon2id with the parameters OWASP recommends and ships an email verification token endpoint. Reimplementing password hashing or token issuance would burn time and create a worse implementation. We use Supabase Auth for the credential primitives and own only the *profile* + *status* + *consent* state in our own tables.

The product strategy commits to São Paulo data residency and SaaS-for-autônomos pricing. PRD 01 dependencies note Resend as the transactional email provider, but Supabase's built-in Auth email delivery suffices for the verification mail and removes one network dependency for the MVP — Resend can be wired later if/when we need branded templates.

## Goals / Non-Goals

**Goals:**

- Capture every PRD 01 cadastro field (name, email, password with complexity, CRP/UF, three consents) at signup time with a single Zod-validated Server Action.
- Make "what state is this account in?" answerable by a single query against our own DB (not by inspecting Supabase Auth metadata across the wire), so middleware and route shells can gate cheaply.
- Encode allowed status transitions in code so a future bug ("admin sets status=`active` directly without verifying email") cannot compile.
- Land the manual CRP review queue as a first-class table now, even though only an internal admin will use it for the MVP — that way the data model does not break when the admin UI ships.
- Keep the existing `/login` and `signIn` semantics for already-`active` users; only the redirect target changes.

**Non-Goals:**

- Google OAuth login (deferred to follow-up change).
- Password reset flow (deferred).
- Login attempt rate limiting and account lockout (deferred).
- Refresh-token / "manter conectado" session duration tuning (deferred).
- Admin UI for the CRP review queue. Reviewers will run a Drizzle Studio query or a one-off Server Action gated by a `service-role` flag for the MVP. The full admin console is a separate PRD.
- Automated CFP lookup. Out for now per PRD §5.1 explicit fallback authorization.
- Photo-of-card upload. RN-01.05 forbids storing the photo in production and the manual reviewer can ask for it out-of-band; building upload + auto-delete is not worth the LGPD blast radius for the MVP.

## Decisions

### Decision 1: Status lives in our own `psychologist_profiles` table, not in Supabase Auth `app_metadata`

We will add a `psychologist_profiles(user_id PK FK auth.users.id, full_name, crp_number, crp_uf, status, terms_accepted_at, privacy_accepted_at, sensitive_data_consent_at, ...)` table.

**Why over the alternatives:**

- *Alternative A — store status in Supabase `app_metadata`*: writes go through the Supabase Auth admin API (extra network call + service-role key in server actions), reads require parsing JSON metadata at every middleware hit, and RLS cannot key off `app_metadata` cleanly. Rejected.
- *Alternative B — single `users` table that mirrors `auth.users`*: tempting for queries, but Supabase warns against writing to `auth.users` directly. A FK-linked profile table is the documented pattern.
- Status as a CHECK-constrained `varchar` (not a Postgres ENUM) so adding a new state later is a DDL `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …` instead of a `pg_enum` rewrite. PRD 11 (anonymization) will eventually add `anonymized` and we want that change to be cheap.

The transitions allowed are:

```
pending_verification ──email verified──▶ pending_crp_validation
pending_crp_validation ──admin approves──▶ active
pending_crp_validation ──admin rejects──▶ suspended
active ──admin suspends──▶ suspended
active ──user cancels──▶ cancelled
suspended ──admin reinstates──▶ active
```

These are encoded as a typed transition function `transitionStatus(current, event): Result<NewStatus, TransitionError>` in `src/modules/account-lifecycle/lib/state-machine.ts`. Direct UPDATEs of `status` outside this helper are forbidden (a unit test asserts the helper is the only writer, by grepping for `.status =`).

### Decision 2: Middleware reads status from a tiny Postgres function, not from a JOIN

Middleware runs on every request. Calling `select status from psychologist_profiles where user_id = $1` works but adds a roundtrip on every page hit. We will:

- Cache `(user_id → status)` in the Supabase session cookie via `auth.setSession`'s `app_metadata` mirror, refreshed whenever status changes.
- The middleware reads the cached status from the JWT payload; it only falls back to a DB query if the JWT is older than the latest status change (using a `status_changed_at` column compared against the JWT's `iat`).

This keeps the hot path JWT-only while still being correct after an admin transitions an account. The mirror is updated by a Postgres trigger on `psychologist_profiles` that calls a `set_app_metadata(user_id, status)` SECURITY DEFINER function.

**Trade-off:** the trigger means a subtle write path. We mitigate by exhaustive integration tests around the transition helper that assert (a) DB row, (b) `auth.users.raw_app_meta_data`, and (c) refreshed JWT all agree.

### Decision 3: CRP validation is two Zod schemas plus a queue, not one validator

PRD 01 §5.1 RF-01.05 has two distinct checks:

1. **Format** — `XX/NNNNNN` where `XX ∈ {01..24}` (Apêndice A regional codes). This is synchronous, runs at the form boundary, and rejects bad input before the user submits.
2. **Identity** — does this CRP actually belong to this person? PRD authorizes manual review.

We will:

- Put format validation in `src/modules/crp-validation/lib/crp-format.ts` as `crpNumberSchema` and `crpUfSchema` Zod refinements with a typed list of valid regional codes pulled from PRD 01 Appendix A.
- Insert a row in `crp_validation_queue` at signup time with `status='pending'`. The admin's approve/reject action toggles `status` and emits a `crp_validation_decided` event that the account-lifecycle state machine consumes.
- Format validation lives in `crp-validation` so when we eventually add automated CFP lookup, both validators sit beside each other behind the same module boundary.

**Why a separate `crp_validation_queue` table instead of fields on `psychologist_profiles`:** keeps the queue independent (multiple submissions over time if a psicóloga changes UF, audit history of who approved/rejected with timestamps, can index `WHERE status='pending'` cheaply for the admin dashboard).

### Decision 4: Three consents, three timestamps — not a single boolean

PRD 01 RF-01.01 demands three distinct checkboxes (Termos, Privacidade, Dados Sensíveis art. 11) and an audit must be able to prove which version was accepted on which date. Single boolean = unprovable. We persist:

```sql
terms_accepted_at TIMESTAMPTZ NOT NULL,
privacy_accepted_at TIMESTAMPTZ NOT NULL,
sensitive_data_consent_at TIMESTAMPTZ NOT NULL,
terms_version TEXT NOT NULL,
privacy_version TEXT NOT NULL,
sensitive_data_consent_version TEXT NOT NULL,
```

The version strings are short identifiers (e.g. `'2026-05'`) sourced from constants in `src/modules/account-lifecycle/lib/document-versions.ts`. PRD 11 (anonymization) will read these to satisfy LGPD audit requests.

### Decision 5: `signUp` is a Server Action, not a Route Handler

Mirrors the existing `signIn` shape (Server Action wrapped by a route shell). Route Handlers are reserved for webhooks (per CLAUDE.md). The signup form is a Client Component that calls the action via `useActionState`, exactly like `LoginForm`.

The action returns a discriminated union:

```ts
type SignUpResult =
  | { ok: true; redirectTo: '/auth/verify-email' }
  | { ok: false; error: 'email_already_registered' | 'crp_already_registered'
                       | 'validation_failed'      | 'unknown';
      fieldErrors?: Partial<Record<keyof SignUpInput, string>> };
```

`fieldErrors` is intentionally not present in `signIn`'s shape because PRD 01 chose usability over enumeration prevention for signup duplicate-email errors (see PRD §8 edge case "Tentativa de cadastro com email já existente"). For login, anti-enumeration still wins.

### Decision 6: Email verification uses Supabase's existing `email_confirm` flow

Supabase Auth issues a one-time token, sends the email (configurable template), and exposes a callback. We add a thin `/auth/callback` Route Handler that:

1. Calls `supabase.auth.exchangeCodeForSession(code)`.
2. On success, transitions the account from `pending_verification` to `pending_crp_validation` via the state-machine helper.
3. Redirects to `/dashboard` (which the middleware will then bounce to `/auth/crp-review` until status is `active`).

We use a Route Handler here, not a Server Action, because the entry point is a GET request from an email click — Server Actions are POST-only.

## Risks / Trade-offs

- **[Manual CRP review SLA]** PRD says "24h." If the admin queue backs up, new psychologists are stuck in `pending_crp_validation` and cannot use the product. → Mitigation: the bloqueante page exposes the queue position and an estimated wait; ops dashboard alerts when oldest pending row > 24h. The admin-facing UI is out of scope here but the data model already supports the metric.
- **[JWT status mirror drift]** Decision 2's mirror could fall out of sync if the trigger fails. → Mitigation: integration test forces a status change and asserts JWT refresh; logger emits `status_mirror_drift` if middleware ever hits the DB-fallback branch in production (so we get a Sentry alert if drift is happening at scale).
- **[Email verification email blocked or slow]** Vercel + Supabase email is best-effort. → Mitigation: PRD 01 §8 already requires a "resend verification" action; we will add a `resendVerification` Server Action gated to `pending_verification` accounts.
- **[Schema migration on a populated DB]** Currently the DB has no users in production. → Mitigation: ship as a single Drizzle migration with no backfill needed; existing dev databases are wiped and re-seeded. If/when this lands after production users exist, we revisit with a backfill plan.
- **[Suspended/cancelled UX is terminal]** A user who hits "cancel account" and then changes their mind has 30 days (per PRD §11 anonymization) to recover, but our `signIn` will reject them outright. → Mitigation: out of scope here (PRD 11 owns recovery); we just emit a clear "Esta conta foi cancelada — contacte suporte" error message per PRD §8.
- **[State machine ergonomics]** Forcing every status write through `transitionStatus()` means tests have to stub it carefully. → Mitigation: factories in `src/__tests__/integration/factories/` expose `seedActiveUser()` / `seedPendingVerificationUser()` helpers that drive the helper internally so test code never touches `status` directly.

## Migration Plan

1. **Drizzle migration** generates `psychologist_profiles` and `crp_validation_queue` plus the `set_app_metadata` SECURITY DEFINER function and trigger. Apply with `npm run db:migrate` in dev, will be re-applied to staging/prod when this change merges.
2. **Module rollout** — code lands behind no flag; the `/signup` route and the new middleware gating activate the moment the deploy is live.
3. **Email template** — Supabase Auth verification email template updated via `supabase/config.toml` (in-repo, applied by `supabase start`); no manual dashboard config required.
4. **Rollback** — drop the two new tables (no FKs from anywhere yet) and revert middleware to the previous "session-only" gating. Existing `/login` keeps working unchanged because `signIn` falls back to `/dashboard` when no profile row exists.

## Open Questions

- *Resend vs Supabase built-in email for the verification mail?* Default plan is Supabase built-in (zero-config); revisit if delivery rates or template branding become an issue. **Decision deferred to deployment time, not blocking the spec.**
- *Should `pending_crp_validation` users be able to fill out their profile (avatar, bio) while they wait?* PRD 01 RF-01.03 says "não pode acessar nenhuma outra funcionalidade until verifies." We extend that to "until `active`" for the MVP — strictest interpretation. Can be relaxed later in PRD 11 (onboarding) if user research demands it.
- *How does the admin actually approve a CRP?* For the MVP, a Drizzle Studio query or a one-off Server Action authenticated against a hardcoded admin email list. Ticket for "build the admin console" is out of scope and tracked in a follow-up PRD.
