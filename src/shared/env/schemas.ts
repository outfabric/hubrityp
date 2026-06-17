import { z } from 'zod';

// Re-export the client-only schema from its isolated file so existing imports
// from `./schemas` keep working. The split prevents the bundler from pulling
// server-env property names (DATABASE_URL, GEMINI_API_KEY, etc.) into the
// client chunk when `client.ts` imports `clientEnvSchema`.
export { clientEnvSchema, type ClientEnv } from './client-schema';
import { clientEnvSchema } from './client-schema';

const logLevels = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof logLevels)[number];

const nodeEnvs = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof nodeEnvs)[number];

// `serverEnvSchema` covers the full set: client-public keys plus secrets that
// must never leave the server (service-role key, log level, DB URL). NODE_ENV
// is included so feature code never has to touch `process.env` directly.
export const serverEnvSchema = clientEnvSchema.extend({
  DATABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Browser-facing Supabase URL. In local Docker the server reaches Kong via
  // an internal hostname (e.g. http://supabase_kong_hubrityp:8000) but the
  // browser must use a host-accessible URL (e.g. http://localhost:54321).
  // When set, signed Storage URLs are rewritten to this origin before being
  // returned to the client. In production this is unnecessary because
  // NEXT_PUBLIC_SUPABASE_URL is already public.
  SUPABASE_PUBLIC_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  NODE_ENV: z.enum(nodeEnvs).default('development'),
  RESEND_API_KEY: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  TWILIO_WEBHOOK_URL: z.string().url().optional(),
  // Estimated cost per WhatsApp template message in BRL.
  // Used for cost estimation display only — not for billing.
  TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL: z.coerce.number().default(0.1),
  // Stream — video/chat API for telepsychology sessions.
  // `STREAM_API_KEY` is the server-side API key (same value as the public key
  // but consumed server-side to instantiate the Node SDK and mint tokens).
  // `STREAM_API_SECRET` is the secret used to sign user tokens — NEVER expose
  // to the client.
  STREAM_API_KEY: z.string().min(1),
  STREAM_API_SECRET: z.string().min(1),
  // Secret used to verify webhook signatures from Stream Video.
  // Validated with `crypto.timingSafeEqual` in the webhook handler.
  STREAM_WEBHOOK_SECRET: z.string().min(1),
  // E2E-only escape hatch. When `'true'`, `getStreamClient()` returns an
  // in-memory no-op stub instead of the real Node SDK, so the seeded
  // Playwright server (which boots `next start` with dummy Stream creds and
  // no network access to Stream's API) never makes real outbound calls.
  // Defaults to `'false'`; production and dev MUST NOT set it. Gating here —
  // rather than in feature code — keeps every route/Server Action path
  // identical between e2e and production except for the SDK transport.
  E2E_STREAM_STUB: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Public-facing application URL (e.g. https://app.hubrity.com).
  // Used server-side to build absolute URLs for patient-facing links in
  // WhatsApp messages (video call links, etc.). Optional because local dev
  // and CI may not have it — features that need it degrade gracefully.
  APP_URL: z.string().url().optional(),
  // Inngest — chaves provisionadas automaticamente pela Vercel Marketplace
  // Integration em production/preview. Em dev local ficam vazias e o SDK
  // usa o Dev Server local (http://inngest:8288 via docker compose).
  INNGEST_EVENT_KEY: z.string().optional(),
  // Required in production for webhook signature verification — the Inngest
  // SDK rejects unauthenticated invocations when the key is present. Optional
  // only for local dev where the Dev Server handles invocation directly.
  INNGEST_SIGNING_KEY: z.string().optional(),
  // Encryption key for @inngest/middleware-encryption. Encrypts all step
  // output (including clinical transcripts and audio base64) client-side
  // before it reaches Inngest Cloud, ensuring LGPD-compliant data residency.
  // Min 32 chars for adequate entropy (AES-256 / LibSodium).
  INNGEST_ENCRYPTION_KEY: z.string().min(32),
  // Override do origem usado no sync com a cloud Inngest (apenas se
  // o domínio publico for diferente do que a Vercel detecta).
  INNGEST_SERVE_ORIGIN: z.string().url().optional(),
  // Gemini — AI transcription and clinical note generation.
  // Required: the API key used to authenticate with the Gemini API.
  GEMINI_API_KEY: z.string().min(1),
  // Model used for audio transcription. Must start with "gemini" or "gemma".
  GEMINI_MODEL_TRANSCRIPTION: z
    .string()
    .regex(/^(gemini|gemma)-/)
    .default('gemini-3.5-flash'),
  // Model used for clinical note generation from transcripts.
  GEMINI_MODEL_NOTE: z
    .string()
    .regex(/^(gemini|gemma)-/)
    .default('gemini-3.5-flash'),
  // Supabase Storage bucket for audio uploads pending transcription.
  AI_TRANSCRIPTION_BUCKET: z.string().default('ai-transcription-audio'),
  // Hours before uploaded audio files are auto-deleted (24-168, default 24).
  AI_TRANSCRIPTION_AUDIO_TTL_HOURS: z.coerce.number().int().min(24).max(168).default(24),
  // Maximum audio file size in MB accepted for transcription (1-500, default 200).
  AI_TRANSCRIPTION_MAX_AUDIO_MB: z.coerce.number().int().min(1).max(500).default(200),
  // Salt used to hash IP and user-agent when recording consent term signatures.
  // The hash provides a legally defensible audit trail without storing PII.
  // REQUIRED in production; min 32 chars for adequate entropy.
  SIGNATURE_HASH_SALT: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
