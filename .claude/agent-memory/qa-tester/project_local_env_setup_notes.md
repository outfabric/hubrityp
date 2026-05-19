---
name: local-env-setup-notes
description: Notes on setting up local environment for QA testing — Supabase stack, migrations, user creation
metadata:
  type: project
---

To QA test locally against the Docker Compose + Supabase stack:

1. Supabase runs via `npx supabase start` (containers named `supabase_*_hubrityp`)
2. Next.js runs via Docker Compose (`docker compose up`)
3. **Migrations must be run explicitly** after Supabase starts: `docker exec <app-container> npm run db:migrate`
4. Email confirmations are enabled; use Mailpit at http://localhost:54324 (API: `/api/v1/messages`)
5. No seed data exists — must create users via signup flow, then confirm email via Mailpit
6. If user was created before migrations ran, manually insert profile row (auth.users trigger won't have fired)
7. Test credentials used: qa-docs-test@example.com / TesteQA@2024! / CRP 06/123456-SP (with 'active' status profile)
8. After user creation, must manually set `status = 'active'` in profiles table to bypass pending_verification gating
9. Worktree-based testing: when testing from a worktree (e.g., `hubrityp-prontuario-formal-documents`), the `.env.local` is in the worktree root, but Supabase containers are shared with main repo

**Why:** The local stack requires manual migration and has no seed data, which can waste time if not anticipated.

**How to apply:** At the start of each QA session, verify migrations are applied (`\dt` in psql should show public tables) before attempting login/signup flows.
