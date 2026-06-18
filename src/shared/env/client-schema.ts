import { z } from 'zod';

// Client-only env schema. Isolated in its own file so the bundler does not
// pull the server schema (with all its secret key names) into the client chunk
// when `client.ts` imports it.
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_STREAM_API_KEY: z.string().min(1),
  // WhatsApp UI entry points (inbox menu item, "WhatsApp"/"Lembretes" settings
  // cards) are frozen behind this flag while the backend is incomplete.
  // `z.coerce.boolean()` is avoided on purpose: it treats any non-empty string
  // (including the literal "false") as `true`. The explicit enum + transform
  // maps only "true" → true and defaults to false when unset.
  NEXT_PUBLIC_WHATSAPP_UI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Absolute base URL of the public marketing site (e.g. https://hubrity.com).
  // Single source of truth for every absolute URL the public site emits:
  // Next `metadataBase`, canonical/og:url tags, sitemap.xml, robots.txt.
  // Defaults to localhost for dev/preview; production MUST set it to the
  // canonical domain so SEO URLs are correct.
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  // Optional privacy-friendly analytics provider, abstracted behind env.
  // When `NEXT_PUBLIC_ANALYTICS_HOST` is unset the analytics loader is a no-op,
  // so local/dev/CI never ship a tracker. `NEXT_PUBLIC_ANALYTICS_SITE_ID` is the
  // provider's site/domain identifier (e.g. a Plausible domain or Umami site id).
  NEXT_PUBLIC_ANALYTICS_HOST: z.string().url().optional(),
  NEXT_PUBLIC_ANALYTICS_SITE_ID: z.string().min(1).optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
