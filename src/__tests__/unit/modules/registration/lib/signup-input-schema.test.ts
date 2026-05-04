import { describe, expect, it } from 'vitest';

import { loginInputSchema } from '@/modules/auth';
import { signupInputSchema } from '@/modules/registration/lib/signup-input-schema';

/**
 * Canonical valid payload — the spec's reference example.
 * Every test that wants to assert a single failure reuses this and overrides
 * exactly the field under test.
 */
const VALID_PAYLOAD = {
  fullName: 'Maria Silva',
  email: 'maria@ex.com',
  password: 'Forte!Senha9',
  passwordConfirm: 'Forte!Senha9',
  crpNumber: '06/123456',
  crpUf: 'SP',
  acceptedTerms: true,
  acceptedPrivacy: true,
  acceptedSensitiveData: true,
} as const;

type FieldErrorRecord = Record<string, string[] | undefined>;

const fieldErrorsOf = (
  result: ReturnType<typeof signupInputSchema.safeParse>,
): FieldErrorRecord => {
  expect(result.success).toBe(false);
  if (result.success) {
    // unreachable; appeases the type narrowing
    throw new Error('expected failure');
  }
  return result.error.flatten().fieldErrors;
};

describe('signupInputSchema — happy path', () => {
  it('accepts the canonical valid payload', () => {
    const result = signupInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('accepts a payload with the multi-UF CRP-20 council', () => {
    const result = signupInputSchema.safeParse({
      ...VALID_PAYLOAD,
      crpNumber: '20/123456',
      crpUf: 'AM',
    });
    expect(result.success).toBe(true);
  });

  it('trims whitespace from fullName', () => {
    const result = signupInputSchema.safeParse({
      ...VALID_PAYLOAD,
      fullName: '   Maria Silva   ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fullName).toBe('Maria Silva');
  });
});

describe('signupInputSchema — fullName', () => {
  it('rejects names shorter than 3 characters', () => {
    const errs = fieldErrorsOf(signupInputSchema.safeParse({ ...VALID_PAYLOAD, fullName: 'AB' }));
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects names longer than 120 characters', () => {
    const errs = fieldErrorsOf(
      signupInputSchema.safeParse({ ...VALID_PAYLOAD, fullName: 'A'.repeat(121) }),
    );
    expect(errs.fullName?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts a name of exactly 120 characters', () => {
    const result = signupInputSchema.safeParse({
      ...VALID_PAYLOAD,
      fullName: 'A'.repeat(120),
    });
    expect(result.success).toBe(true);
  });
});

describe('signupInputSchema — email', () => {
  it('rejects malformed emails', () => {
    const errs = fieldErrorsOf(
      signupInputSchema.safeParse({ ...VALID_PAYLOAD, email: 'not-an-email' }),
    );
    expect(errs.email?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects empty email', () => {
    const errs = fieldErrorsOf(signupInputSchema.safeParse({ ...VALID_PAYLOAD, email: '' }));
    expect(errs.email?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('signupInputSchema — password / passwordConfirm', () => {
  it('rejects a weak password (fails the strong-password policy) on the password field', () => {
    const errs = fieldErrorsOf(
      signupInputSchema.safeParse({
        ...VALID_PAYLOAD,
        password: 'fraca',
        passwordConfirm: 'fraca',
      }),
    );
    expect(errs.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a mismatched passwordConfirm with the error pinned to passwordConfirm', () => {
    const result = signupInputSchema.safeParse({
      ...VALID_PAYLOAD,
      passwordConfirm: 'Forte!Senha8',
    });
    const errs = fieldErrorsOf(result);
    expect(errs.passwordConfirm?.length ?? 0).toBeGreaterThan(0);
    // Per the spec: error keyed on `passwordConfirm`, not `password`.
    expect(errs.password).toBeUndefined();
  });

  it('emits the pt-BR mismatch message on passwordConfirm', () => {
    const result = signupInputSchema.safeParse({
      ...VALID_PAYLOAD,
      passwordConfirm: 'Forte!Senha8',
    });
    const errs = fieldErrorsOf(result);
    expect(errs.passwordConfirm).toContain('As senhas não coincidem.');
  });
});

describe('signupInputSchema — crpNumber format', () => {
  it.each([
    ['6/12345', 'single-digit regional'],
    ['06-123456', 'hyphen separator'],
    ['06/12', 'serial too short'],
    ['', 'empty string'],
    ['06123456', 'no separator'],
    ['06/12345678', 'serial too long'],
  ])('rejects malformed crpNumber: "%s" (%s)', (crpNumber) => {
    const errs = fieldErrorsOf(signupInputSchema.safeParse({ ...VALID_PAYLOAD, crpNumber }));
    expect(errs.crpNumber?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('signupInputSchema — crpUf membership', () => {
  it('rejects an unknown UF code', () => {
    const errs = fieldErrorsOf(signupInputSchema.safeParse({ ...VALID_PAYLOAD, crpUf: 'XX' }));
    expect(errs.crpUf?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects an empty UF', () => {
    const errs = fieldErrorsOf(signupInputSchema.safeParse({ ...VALID_PAYLOAD, crpUf: '' }));
    expect(errs.crpUf?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('signupInputSchema — crpNumber/crpUf cross-field consistency', () => {
  it('rejects a regional/UF mismatch (06 reserved for SP, paired with RJ)', () => {
    const result = signupInputSchema.safeParse({
      ...VALID_PAYLOAD,
      crpNumber: '06/123456',
      crpUf: 'RJ',
    });
    const errs = fieldErrorsOf(result);
    // Spec: error pointing at crpNumber OR crpUf with pt-BR mismatch message.
    const onCrpNumber = errs.crpNumber ?? [];
    const onCrpUf = errs.crpUf ?? [];
    expect(onCrpNumber.length + onCrpUf.length).toBeGreaterThan(0);
    // Match on substrings flexible enough to survive small copy edits but
    // strict enough to confirm the message is the regional-mismatch one.
    const ALL_MESSAGES = [...onCrpNumber, ...onCrpUf].join(' | ');
    expect(ALL_MESSAGES).toMatch(/CRP.*UF|UF.*CRP|não corresponde|incompat/i);
  });

  it('accepts a 1:N CRP-20 council pairing for any covered UF', () => {
    for (const uf of ['AM', 'RR', 'AC', 'RO']) {
      const result = signupInputSchema.safeParse({
        ...VALID_PAYLOAD,
        crpNumber: '20/123456',
        crpUf: uf,
      });
      expect(result.success, `expected ${uf} to be accepted under CRP-20`).toBe(true);
    }
  });
});

describe('signupInputSchema — consents', () => {
  it.each([
    ['acceptedTerms'],
    ['acceptedPrivacy'],
    ['acceptedSensitiveData'],
  ] as const)('rejects when %s is false', (field) => {
    const errs = fieldErrorsOf(signupInputSchema.safeParse({ ...VALID_PAYLOAD, [field]: false }));
    expect(errs[field]?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects when all three consents are false, with errors on each', () => {
    const errs = fieldErrorsOf(
      signupInputSchema.safeParse({
        ...VALID_PAYLOAD,
        acceptedTerms: false,
        acceptedPrivacy: false,
        acceptedSensitiveData: false,
      }),
    );
    expect(errs.acceptedTerms?.length ?? 0).toBeGreaterThan(0);
    expect(errs.acceptedPrivacy?.length ?? 0).toBeGreaterThan(0);
    expect(errs.acceptedSensitiveData?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('login schema unchanged (regression guard)', () => {
  it('still accepts an 8-char password for the login flow (login is not subject to the strong-password policy)', () => {
    const result = loginInputSchema.safeParse({
      email: 'a@b.co',
      password: '12345678',
    });
    expect(result.success).toBe(true);
  });
});
