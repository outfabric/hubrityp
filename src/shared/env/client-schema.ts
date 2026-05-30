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
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
