import { describe, expect, it } from 'vitest';

import { completeProfileInputSchema } from '@/modules/oauth/lib/complete-profile-input-schema';

/**
 * Canonical valid payload for complete-profile (OAuth flow).
 * No email or password — the OAuth provider already supplied those.
 */
const VALID_PAYLOAD = {
  fullName: 'Maria Silva',
  crpNumber: '06/123456',
  crpUf: 'SP',
  acceptedTerms: true,
  acceptedPrivacy: true,
  acceptedSensitiveData: true,
} as const;

type FieldErrorRecord = Record<string, string[] | undefined>;

const fieldErrorsOf = (
  result: ReturnType<typeof completeProfileInputSchema.safeParse>,
): FieldErrorRecord => {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('expected failure');
  return result.error.flatten().fieldErrors;
};

describe('completeProfileInputSchema — happy path', () => {
  it('accepts the canonical valid payload', () => {
    const result = completeProfileInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('accepts a multi-UF CRP-20 council pairing', () => {
    const result = completeProfileInputSchema.safeParse({
      ...VALID_PAYLOAD,
      crpNumber: '20/123456',
      crpUf: 'AM',
    });
    expect(result.success).toBe(true);
  });

  it('trims whitespace from fullName', () => {
    const result = completeProfileInputSchema.safeParse({
      ...VALID_PAYLOAD,
      fullName: '   Maria Silva   ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fullName).toBe('Maria Silva');
  });
});

describe('completeProfileInputSchema — fullName', () => {
  it('rejects names shorter than 3 characters', () => {
    const errs = fieldErrorsOf(
      completeProfileInputSchema.safeParse({ ...VALID_PAYLOAD, fullName: 'AB' }),
    );
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects names longer than 120 characters', () => {
    const errs = fieldErrorsOf(
      completeProfileInputSchema.safeParse({ ...VALID_PAYLOAD, fullName: 'A'.repeat(121) }),
    );
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('completeProfileInputSchema — CRP format', () => {
  it.each([
    ['6/12345', 'single-digit regional'],
    ['06-123456', 'hyphen separator'],
    ['06/12', 'serial too short'],
    ['', 'empty string'],
  ])('rejects malformed crpNumber: "%s" (%s)', (crpNumber) => {
    const errs = fieldErrorsOf(
      completeProfileInputSchema.safeParse({ ...VALID_PAYLOAD, crpNumber }),
    );
    expect(errs.crpNumber?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('completeProfileInputSchema — crpUf membership', () => {
  it('rejects an unknown UF code', () => {
    const errs = fieldErrorsOf(
      completeProfileInputSchema.safeParse({ ...VALID_PAYLOAD, crpUf: 'XX' }),
    );
    expect(errs.crpUf?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('completeProfileInputSchema — CRP/UF cross-field consistency', () => {
  it('rejects a regional/UF mismatch (06 is SP, paired with RJ)', () => {
    const errs = fieldErrorsOf(
      completeProfileInputSchema.safeParse({
        ...VALID_PAYLOAD,
        crpNumber: '06/123456',
        crpUf: 'RJ',
      }),
    );
    const onCrpNumber = errs.crpNumber ?? [];
    expect(onCrpNumber.length).toBeGreaterThan(0);
    expect(onCrpNumber.join(' ')).toMatch(/CRP.*UF|UF.*CRP|não corresponde/i);
  });
});

describe('completeProfileInputSchema — consents', () => {
  it.each([['acceptedTerms'], ['acceptedPrivacy'], ['acceptedSensitiveData']] as const)(
    'rejects when %s is false',
    (field) => {
      const errs = fieldErrorsOf(
        completeProfileInputSchema.safeParse({ ...VALID_PAYLOAD, [field]: false }),
      );
      expect(errs[field]?.length ?? 0).toBeGreaterThan(0);
    },
  );
});

describe('completeProfileInputSchema — does NOT require email or password', () => {
  it('does not fail when email and password are absent', () => {
    // The schema should not have email or password fields at all.
    const result = completeProfileInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });
});
