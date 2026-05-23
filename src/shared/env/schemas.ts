import { z } from 'zod';

const logLevels = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof logLevels)[number];

// `clientEnvSchema` covers only `NEXT_PUBLIC_*` keys (statically inlined into
// the browser bundle by Next). It is the schema a client component would
// import via a future `src/shared/env/client.ts` shim.
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_STREAM_API_KEY: z.string().min(1),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

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
  // Inngest — chaves provisionadas automaticamente pela Vercel Marketplace
  // Integration em production/preview. Em dev local ficam vazias e o SDK
  // usa o Dev Server local (http://inngest:8288 via docker compose).
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  // Override do origem usado no sync com a cloud Inngest (apenas se
  // o domínio publico for diferente do que a Vercel detecta).
  INNGEST_SERVE_ORIGIN: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
