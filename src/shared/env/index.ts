import 'server-only';

import { clientEnv } from './client';
import { clientEnvSchema, serverEnvSchema, type ClientEnv, type ServerEnv } from './schemas';

export { clientEnvSchema, serverEnvSchema };
export type { ClientEnv, ServerEnv };
export { clientEnv };

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[env] Invalid server environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid server environment variables — see log above.');
}

export const serverEnv: ServerEnv = parsed.data;

// Production guard: INNGEST_SIGNING_KEY is optional in the schema (for local
// dev) but MUST be set in production — without it, anyone who can POST to
// /api/inngest can trigger sensitive pipeline functions unauthenticated.
if (parsed.data.NODE_ENV === 'production' && !parsed.data.INNGEST_SIGNING_KEY) {
  throw new Error(
    '[env] INNGEST_SIGNING_KEY is required in production for webhook signature verification.',
  );
}
