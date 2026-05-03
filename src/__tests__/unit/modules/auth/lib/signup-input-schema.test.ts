import { describe, expect, it } from 'vitest';

import { signupInputSchema } from '@/modules/auth/lib/signup-input-schema';

// Spec scenarios for `signupInputSchema`. Each test corresponds to a
// scenario listed under Requirement "signupInputSchema validates the
// cadastro payload" in `openspec/changes/add-account-signup-and-lifecycle/
// specs/authentication/spec.md`.

const validInput = {
  fullName: 'Ana Silva',
  email: 'ana@example.com',
  password: 'Senha!Forte9',
  passwordConfirm: 'Senha!Forte9',
  crpNumber: '06/123456',
  crpUf: 'SP',
  acceptedTerms: true,
  acceptedPrivacy: true,
  acceptedSensitiveData: true,
} as const;

describe('signupInputSchema', () => {
  describe('valid payloads', () => {
    it('accepts a fully valid payload — spec scenario "Schema accepts a valid payload"', () => {
      const result = signupInputSchema.safeParse({ ...validInput });
      expect(result.success).toBe(true);
    });

    it('lower-cases the email at the schema boundary', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        email: 'Ana@Example.COM',
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.email).toBe('ana@example.com');
    });

    it('trims the full name', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        fullName: '   Ana Silva   ',
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.fullName).toBe('Ana Silva');
    });
  });

  describe('full name', () => {
    it('rejects names shorter than 3 characters', () => {
      const result = signupInputSchema.safeParse({ ...validInput, fullName: 'An' });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.fullName?.length ?? 0).toBeGreaterThan(0);
    });

    it('rejects names longer than 120 characters', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        fullName: 'A'.repeat(121),
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.fullName?.length ?? 0).toBeGreaterThan(0);
    });

    it('accepts names of exactly 3 and 120 characters (the boundaries)', () => {
      // Use spaces in the 3-char case so the trim doesn't reduce length.
      // The 3-char minimum is post-trim, so 'A B' (3 chars) qualifies.
      expect(signupInputSchema.safeParse({ ...validInput, fullName: 'Ana' }).success).toBe(true);
      expect(
        signupInputSchema.safeParse({ ...validInput, fullName: 'A'.repeat(120) }).success,
      ).toBe(true);
    });
  });

  describe('email', () => {
    it('rejects a malformed email', () => {
      const result = signupInputSchema.safeParse({ ...validInput, email: 'not-an-email' });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.email).toContain('E-mail inválido.');
    });

    it('rejects an empty email', () => {
      const result = signupInputSchema.safeParse({ ...validInput, email: '' });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.email?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe('password complexity (RF-01.04)', () => {
    it('rejects a password without an upper-case letter — spec scenario "Password without an upper-case letter is rejected"', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: 'senha!forte9',
        passwordConfirm: 'senha!forte9',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.password).toBeDefined();
      // Spec: the error message MUST explicitly mention the missing
      // upper-case requirement. We assert on a substring rather than the
      // full string so wording can be tweaked without breaking the test.
      expect(errors.password?.some((m) => m.toLowerCase().includes('maiúscula'))).toBe(true);
    });

    it('rejects a password without a lower-case letter', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: 'SENHA!FORTE9',
        passwordConfirm: 'SENHA!FORTE9',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.password?.some((m) => m.toLowerCase().includes('minúscula'))).toBe(true);
    });

    it('rejects a password without a digit', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: 'SenhaForte!',
        passwordConfirm: 'SenhaForte!',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.password?.some((m) => m.toLowerCase().includes('número'))).toBe(true);
    });

    it('rejects a password without a special character', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: 'SenhaForte9',
        passwordConfirm: 'SenhaForte9',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.password?.some((m) => m.toLowerCase().includes('especial'))).toBe(true);
    });

    it('rejects a password shorter than 10 characters — spec scenario "Password shorter than 10 characters is rejected"', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: 'Senha!9',
        passwordConfirm: 'Senha!9',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.password?.some((m) => m.includes('10 caracteres'))).toBe(true);
    });

    it('emits ALL missing-class errors at once when the password is empty', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: '',
        passwordConfirm: '',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      // Every class is missing PLUS the length requirement. We expect at
      // least 5 issues so the user sees every requirement at once instead
      // of having to iterate.
      expect((errors.password?.length ?? 0) >= 5).toBe(true);
    });

    it('accepts a password that meets every requirement', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: 'Senha!Forte9',
        passwordConfirm: 'Senha!Forte9',
      });
      expect(result.success).toBe(true);
    });

    it('accepts every special character listed in the schema', () => {
      const specials = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      for (const ch of specials) {
        const password = `Senha9Aa${ch}1`;
        const result = signupInputSchema.safeParse({
          ...validInput,
          password,
          passwordConfirm: password,
        });
        expect(result.success, `expected schema to accept special "${ch}"`).toBe(true);
      }
    });
  });

  describe('password confirmation', () => {
    it('rejects when password and confirmation do not match — spec scenario "Password confirmation mismatch is rejected"', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        password: 'Senha!Forte9',
        passwordConfirm: 'Senha!Forte0',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      // Refinement targets the `passwordConfirm` path so the form can
      // surface the error inline next to the confirmation input.
      expect(errors.passwordConfirm?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe('CRP delegation', () => {
    it('rejects a malformed CRP — spec scenario "Invalid CRP format is rejected"', () => {
      const result = signupInputSchema.safeParse({ ...validInput, crpNumber: 'abc' });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.crpNumber?.length ?? 0).toBeGreaterThan(0);
    });

    it('rejects an unknown UF', () => {
      const result = signupInputSchema.safeParse({ ...validInput, crpUf: 'XX' });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.crpUf?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe('consent literals', () => {
    it('rejects when sensitive-data consent is unchecked — spec scenario "Unchecked consent is rejected"', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        acceptedSensitiveData: false,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.acceptedSensitiveData?.length ?? 0).toBeGreaterThan(0);
    });

    it('rejects when terms consent is unchecked', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        acceptedTerms: false,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.acceptedTerms?.length ?? 0).toBeGreaterThan(0);
    });

    it('rejects when privacy consent is unchecked', () => {
      const result = signupInputSchema.safeParse({
        ...validInput,
        acceptedPrivacy: false,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const errors = result.error.flatten().fieldErrors;
      expect(errors.acceptedPrivacy?.length ?? 0).toBeGreaterThan(0);
    });
  });
});
