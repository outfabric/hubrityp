import { z } from 'zod';

// Client-only env schema. Isolated in its own file so the bundler does not
// pull the server schema (with all its secret key names) into the client chunk
// when `client.ts` imports it.
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_STREAM_API_KEY: z.string().min(1),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
