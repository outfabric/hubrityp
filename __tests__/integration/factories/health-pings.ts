import { randomUUID } from 'node:crypto';

import { type NewHealthPing } from '@/db/schema/health/tables';

// Type-safe factory for `health_pings` insert payloads. The input type comes
// straight from the Drizzle schema, so any column rename will surface here as
// a type error in tests — by design.
export const healthPingFactory = {
  build(overrides: Partial<NewHealthPing> = {}): NewHealthPing {
    return {
      id: randomUUID(),
      ownerId: randomUUID(),
      note: 'factory-generated ping',
      ...overrides,
    };
  },
};
