# PR Checklist — ai-transcription-consent

Items that MUST be verified before merging this change.

## Environment variables

- [ ] **`SIGNATURE_HASH_SALT`** provisioned in Vercel project settings (server-only, min 32 chars).
  - Purpose: hashing IP address and user-agent when a patient signs the AI consent term, so we store a non-reversible fingerprint rather than raw PII.
  - Generate with: `openssl rand -base64 48`
  - Must NOT have a `NEXT_PUBLIC_` prefix — it is consumed exclusively server-side by the consent-signing Server Action.
  - Added to `.env.example` and validated by the `serverEnv` Zod schema (minimum 32 characters enforced at boot).

## Legal sign-off

- [ ] **`AI_CONSENT_TEMPLATE_V1`** reviewed and approved by legal counsel before merge.
  - The template text lives in `src/modules/patients/lib/ai-consent-template.ts` and is rendered verbatim to patients on the public consent page (`/termo/[token]`).
  - It covers: scope of AI transcription, data handling, LGPD legal basis, right to revoke, data retention policy, and contact information.
  - Any change to the template text after legal approval requires a new version (`V2`) and a re-consent flow — the current version is immutable once approved.

## Pre-merge verification

- [ ] Migration tested against local Postgres (forward + rollback).
- [ ] Negative-auth tests pass for all new Server Actions and public routes.
- [ ] All test suites green: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e:seeded`.
