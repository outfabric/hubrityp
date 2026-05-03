import { randomUUID } from 'node:crypto';

import { type NewCrpValidationQueueRow } from '@/shared/db/schema/auth/crp-validation-queue';

// Type-safe factory for `crp_validation_queue` insert payloads. The input
// type is derived directly from the Drizzle schema, so any column rename or
// nullability change surfaces here as a type error in tests — by design.
//
// Defaults pick `pending` as the starting status and leave `decidedAt` /
// `decidedBy` / `rejectionReason` unset. Tests that need a row in
// `approved` or `rejected` can override via the partial.
//
// Random 6-digit `crp_number` per call avoids collisions when several factory
// rows coexist within the same suite — though `crp_validation_queue` itself
// has no UNIQUE constraint on (crp_number, crp_uf) (that constraint is on
// `psychologist_profiles`), the test data still benefits from being
// distinguishable in failure messages.
export const crpValidationQueueFactory = {
  build(overrides: Partial<NewCrpValidationQueueRow> = {}): NewCrpValidationQueueRow {
    const crpNumber = `06/${String(Math.floor(100000 + Math.random() * 900000))}`;
    return {
      id: randomUUID(),
      userId: randomUUID(),
      crpNumber,
      crpUf: 'SP',
      status: 'pending',
      // `submittedAt` is intentionally omitted so the DB DEFAULT (`now()`)
      // applies. Tests that need a deterministic timestamp can override.
      ...overrides,
    };
  },
};
