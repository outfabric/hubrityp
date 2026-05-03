import { randomUUID } from 'node:crypto';

import { type NewPsychologistProfile } from '@/shared/db/schema/auth/psychologist-profiles';

// Type-safe factory for `psychologist_profiles` insert payloads. The input
// type comes straight from the Drizzle schema — any column rename will
// surface here as a type error in tests, by design.
//
// Defaults pick `pending_verification` as the starting status, mirroring the
// signup flow. CRP defaults are unique per call to avoid (crp_number, crp_uf)
// collisions across parallel tests in the same suite.
export const psychologistProfileFactory = {
  build(overrides: Partial<NewPsychologistProfile> = {}): NewPsychologistProfile {
    const now = new Date();
    // Random 6-digit CRP within a UF avoids UNIQUE collisions when several
    // factory rows share the same suite run.
    const crpNumber = String(Math.floor(100000 + Math.random() * 900000));
    return {
      userId: randomUUID(),
      fullName: 'Dra. Factory',
      crpNumber,
      crpUf: 'SP',
      status: 'pending_verification',
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      sensitiveDataConsentAt: now,
      termsVersion: '2026-05',
      privacyVersion: '2026-05',
      sensitiveDataConsentVersion: '2026-05',
      ...overrides,
    };
  },
};
