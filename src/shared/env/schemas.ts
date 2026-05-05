import { z } from 'zod';

const logLevels = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof logLevels)[number];

// `clientEnvSchema` covers only `NEXT_PUBLIC_*` keys (statically inlined into
// the browser bundle by Next). It is the schema a client component would
// import via a future `src/shared/env/client.ts` shim.
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
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
  LOG_LEVEL: z.enum(logLevels).default('info'),
  NODE_ENV: z.enum(nodeEnvs).default('development'),
  RESEND_API_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
