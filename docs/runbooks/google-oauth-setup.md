# Google OAuth Setup

How to obtain Google OAuth credentials and configure "Sign in with Google" for HubrityP.

## 1. Create a Google Cloud project (skip if you already have one)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project selector in the top bar and choose **New Project**.
3. Name it (e.g. `hubrityp-dev`) and click **Create**.

## 2. Configure the OAuth consent screen

1. In the Cloud Console sidebar, go to **APIs & Services > OAuth consent screen**.
2. Choose **External** user type (unless you have a Google Workspace org and want internal-only).
3. Fill in the required fields:
   - **App name**: `HubrityP` (or `HubrityP Dev` for development).
   - **User support email**: your email.
   - **Developer contact information**: your email.
4. Under **Scopes**, add `openid`, `email`, and `profile`.
5. Save and continue. You can skip the test-users step for now.

## 3. Create OAuth 2.0 credentials

1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Application type: **Web application**.
4. Name: `HubrityP Web` (or similar).
5. Under **Authorized JavaScript origins**, add:
   - Local: `http://localhost:3000`
   - Local (alt): `http://127.0.0.1:3000`
   - Production: `https://<your-production-domain>`
6. Under **Authorized redirect URIs**, add the Supabase Auth callback URLs:
   - Local: `http://127.0.0.1:54321/auth/v1/callback`
   - Production: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
7. Click **Create** and note the **Client ID** and **Client Secret**.

## 4. Configure environment variables

Copy the credentials into your `.env.local` (never commit this file):

```env
GOOGLE_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>
```

These are read by the Supabase CLI via `env()` references in `supabase/config.toml`
and validated (as optional) by the app through `src/shared/env/schemas.ts`.

## 5. Verify local setup

1. Start the local Supabase stack:
   ```bash
   docker compose up
   ```
2. Confirm Google is listed as an enabled provider:
   ```bash
   npx supabase status
   ```
3. Visit `http://localhost:3000/login` and click "Entrar com Google".
4. You should be redirected to Google's consent screen, then back to the app.

## 6. Production setup (Supabase Dashboard)

For production, the credentials are set through the Supabase Dashboard, not `config.toml`:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) > your project > **Authentication > Providers**.
2. Enable **Google** and paste your production **Client ID** and **Client Secret**.
3. The redirect URI shown in the dashboard (`https://<ref>.supabase.co/auth/v1/callback`) must match what you configured in the Google Cloud Console (step 3.6 above).
4. Also set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in your Vercel environment variables so the app's server-side env validation passes.

## Troubleshooting

| Symptom                       | Cause                                                                    | Fix                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redirect_uri_mismatch` error | The callback URL in Google Console does not match the Supabase auth URL. | Double-check the **Authorized redirect URIs** in step 3.6. For local dev it must be `http://127.0.0.1:54321/auth/v1/callback` (not `localhost`). |
| Nonce mismatch in local dev   | Google OIDC nonce validation fails in the local GoTrue container.        | `skip_nonce_check = true` is already set in `supabase/config.toml` for the Google provider. Make sure you are using the latest config.           |
| Google button not visible     | `GOOGLE_OAUTH_CLIENT_ID` is not set.                                     | The UI conditionally renders the button. Set the env var and restart the dev server.                                                             |
| `invalid_client` error        | Wrong client secret or the credential was deleted/rotated.               | Re-check the secret in Google Cloud Console > Credentials.                                                                                       |
