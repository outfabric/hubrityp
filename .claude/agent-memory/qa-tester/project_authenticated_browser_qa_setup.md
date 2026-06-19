---
name: authenticated-browser-qa-setup
description: How to reach an authenticated psychologist UI for browser QA on local Docker — run db:migrate then create an active account via the admin API (with 6 required user_metadata fields), since docker compose up alone leaves the DB empty
metadata:
  type: project
---

To browser-QA any authenticated page (sidebar, /configuracoes, /dashboard, prontuario, etc.) on the local Docker stack you must do two precondition steps that `docker compose up` does NOT do.

**Why:** `docker compose up` boots the Next.js app + Supabase containers but (a) does NOT run Drizzle migrations and (b) there is no email/password seed for the real local Supabase (only `e2e/seeded` mock-GoTrue state, which the running app does not use). A fresh stack therefore has only Supabase system schemas — no `public.profiles`, so login cannot resolve a profile and middleware cannot route to `/dashboard`.

**How to apply (verified working 2026-05-30):**
1. Apply migrations inside the app container: `docker exec <app-container> sh -lc 'cd /app && npm run db:migrate'` (or `npm run db:migrate` from the worktree). Creates `public.*` tables incl. `public.profiles`.
2. Create an active psychologist account. The clean path is the admin API — a DB trigger `handle_new_user` auto-creates the `public.profiles` row from user metadata, but it REQUIRES six metadata fields or it raises `P0001: missing required metadata field "<x>"`:
   - `POST http://localhost:54321/auth/v1/admin/users` with header `Authorization: Bearer $SERVICE_ROLE_KEY` and body:
     `{"email":"...","password":"...","email_confirm":true,"user_metadata":{"fullName":"QA Psicologa Teste","crpNumber":"123456","crpUf":"SP","termsAcceptedAt":"2026-05-30T00:00:00Z","privacyAcceptedAt":"2026-05-30T00:00:00Z","sensitiveDataConsentAt":"2026-05-30T00:00:00Z"}}`. Service-role + anon keys are in the worktree `.env.local`.
   - The trigger seeds `status='pending_crp_validation'`; promote it: `UPDATE public.profiles SET status='active', email_verified_at=now(), crp_validated_at=now() WHERE email='<email>';`
   - `profiles` columns are `crp_number`+`crp_uf` (NOT `crp`); `status` is plain text with a CHECK ∈ {pending_verification, pending_crp_validation, active, suspended, cancelled}; `'active'` routes to `/dashboard`.
   - Verify API login works: `POST {:54321}/auth/v1/token?grant_type=password` (apikey = anon) returns an `access_token`.
   - Do NOT hand-insert into `auth.users`/`auth.identities` (the trigger + GoTrue identity wiring make that error-prone); the admin API is simplest. Email signup is ENABLED in local config (`supabase/config.toml:216 enable_signup=true`).
3. Log in at `/login` (fill textbox "E-mail", textbox "Senha", click button "Entrar"). The submit is a Server Action that returns 303 → `/dashboard`; the auth cookie `sb-...-auth-token` is set. Wait ~3-4s after click before reading `location.pathname` — the redirect resolves asynchronously (reading too early shows `/login`, a false negative).

**Cookie-injection fallback (verified 2026-06-08):** UI signup/login can leave NO usable session when `NEXT_PUBLIC_SUPABASE_URL=http://supabase_kong_hubrityp:8000` (browser can't resolve the docker-internal host, so the client-side PKCE exchange never completes — only a `...-code-verifier` cookie appears). Workaround: signup via the UI server action *does* create the user server-side; then mint a session from the host: `POST {:54321}/auth/v1/token?grant_type=password` (apikey=anon) → build the Supabase ssr session JSON `{access_token,refresh_token,expires_in,expires_at,token_type:'bearer',user}`, prefix the base64 with `base64-`, and set it as cookie `sb-supabase_kong_hubrityp-auth-token` — CHUNK into `.0`/`.1` at ~3180 chars if >4096 (`playwright-cli cookie-set <name>.<i> <chunk> --domain=localhost`). Navigating then resolves an authenticated session server-side. Also remember to `UPDATE auth.users SET email_confirmed_at=now()` + `UPDATE public.profiles SET status='active'` for the new user. CRP format is `NN/MMMMMMM` where NN must map to the UF (SP→06, so `06/123456`); plain `123456` fails client validation silently (aria-invalid on crpNumber, no toast).

Ports: Kong/API on host `localhost:54321` (`/auth/v1/health` → 200), Postgres on `localhost:54322`. DB container name `supabase_db_hubrityp` (psql -U postgres -d postgres). See [[local-env-setup-notes]].

Pre-existing dev-only console noise to ignore on every page: CSP errors for internal hostname `http://supabase_kong_hubrityp:8000` (img/connect/frame-src), React dev `eval()` not supported, favicon 404. None are app/feature defects.
