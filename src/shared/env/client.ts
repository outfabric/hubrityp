// Client-safe env shim. Imported by `'use client'` components and by browser
// bundles that must not pull the `server-only` cascade in `src/shared/env/index.ts`.
//
// Next.js statically inlines every `NEXT_PUBLIC_*` reference at build time,
// so the `process.env.*` reads below are replaced with literal strings in the
// client bundle. The ESLint exemption for this file in `eslint.config.mjs`
// permits the direct reads.
import { clientEnvSchema, type ClientEnv } from './client-schema';

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_STREAM_API_KEY: process.env.NEXT_PUBLIC_STREAM_API_KEY,
  NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED: process.env.NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED,
  NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED: process.env.NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED,
  NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED:
    process.env.NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_ANALYTICS_HOST: process.env.NEXT_PUBLIC_ANALYTICS_HOST,
  NEXT_PUBLIC_ANALYTICS_SITE_ID: process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID,
});

if (!parsed.success) {
  console.error(
    '[env/client] Invalid public environment variables:',
    parsed.error.flatten().fieldErrors,
  );
  throw new Error('Invalid public environment variables — see log above.');
}

export const clientEnv: ClientEnv = parsed.data;
