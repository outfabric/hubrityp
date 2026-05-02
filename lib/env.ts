import 'server-only';

import { clientEnv } from './env/client';
import { clientEnvSchema, serverEnvSchema, type ClientEnv, type ServerEnv } from './env/schemas';

export { clientEnvSchema, serverEnvSchema };
export type { ClientEnv, ServerEnv };
export { clientEnv };

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[env] Invalid server environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid server environment variables — see log above.');
}

export const serverEnv: ServerEnv = parsed.data;
