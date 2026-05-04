import { randomUUID } from 'node:crypto';

import type { SignupInput } from '@/modules/registration';

// Each call returns a unique email so concurrent factory uses inside the
// same test process don't collide on the duplicate-email branch when the
// caller didn't intend to. The local-part is a UUID with dashes stripped
// (RFC 5321 friendly) and the domain is `test.local` — guaranteed by
// IANA reservation to never resolve, so a stray send-attempt cannot
// reach a real mailbox.
function uniqueEmail(): string {
  return `${randomUUID().replace(/-/g, '')}@test.local`;
}

// Random 6-digit CRP suffix so two factory calls don't produce the same
// (crp_number, crp_uf) pair by default. Tests that DO want a duplicate
// pass the explicit value via `with({ crpNumber, crpUf })`.
function uniqueCrpNumber(prefix = '06'): string {
  // 100000..999999 keeps the suffix length stable (6 digits) and avoids
  // leading zeros, which would also be valid but harder to read in
  // assertion failures.
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}/${suffix}`;
}

// Canonical valid payload used as the base for every test. The CRP
// regional code (06) belongs to São Paulo, so the default UF is `SP`
// (the cross-field validator on the schema accepts this combination).
const BASE_PAYLOAD = {
  fullName: 'Maria Silva',
  email: '',
  password: 'Forte!Senha9',
  passwordConfirm: 'Forte!Senha9',
  crpNumber: '',
  crpUf: 'SP',
  acceptedTerms: true as const,
  acceptedPrivacy: true as const,
  acceptedSensitiveData: true as const,
};

/**
 * Build a fresh, schema-valid signup payload. Each call produces a
 * unique email and CRP number unless overridden via `overrides`.
 *
 * Returned object is `Partial<SignupInput>`-shaped but all required
 * fields are present — the broadened type accommodates tests that pass
 * literal-`true` consents back in via spread (Zod's `z.literal(true)`
 * narrows to `true` only when the source is `as const`).
 */
export function validSignupInput(
  overrides: Partial<Record<keyof SignupInput, unknown>> = {},
): Record<string, unknown> {
  return {
    ...BASE_PAYLOAD,
    email: uniqueEmail(),
    crpNumber: uniqueCrpNumber(),
    ...overrides,
  };
}

/**
 * Convert a payload object into a `FormData` instance suitable for
 * `signUpImpl(formData)`. Booleans are serialized as `'on'` (the
 * checkbox convention used by `signUpImpl`'s `coerceCheckbox` helper).
 * Missing keys are skipped — callers can drop a consent (e.g.
 * `acceptedTerms: undefined`) to test the schema-failure path.
 */
export function payloadToFormData(payload: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') {
      if (value) fd.set(key, 'on');
      continue;
    }
    if (typeof value === 'string') {
      fd.set(key, value);
      continue;
    }
    if (typeof value === 'number') {
      fd.set(key, String(value));
      continue;
    }
    // Anything else (object, function, etc.) is an authoring mistake —
    // throw rather than coerce silently. The factory is test-only, so a
    // loud failure is more useful than `[object Object]` in the form.
    throw new Error(`payloadToFormData: unsupported value type for "${key}": ${typeof value}`);
  }
  return fd;
}

// Convenience exports so individual tests can compose payloads concisely
// (`validSignupInput({ email: 'reused@test.local' })`).
export const signupInputFactory = {
  build: validSignupInput,
  toFormData: payloadToFormData,
  uniqueEmail,
  uniqueCrpNumber,
};
