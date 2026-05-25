# PR Checklist — ai-transcription-consent

Items that MUST be verified before merging this change.

- [ ] Texto de `AI_CONSENT_TEMPLATE_V1` revisado por responsável legal antes do merge.
- [ ] Migration tested against local Postgres (forward + rollback).
- [ ] New `SIGNATURE_HASH_SALT` env var documented and provisioned in Vercel project settings.
- [ ] Negative-auth tests pass for all new Server Actions and public routes.
