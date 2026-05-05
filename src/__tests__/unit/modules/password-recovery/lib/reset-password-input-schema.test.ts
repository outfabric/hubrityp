import { describe, expect, it } from 'vitest';

import { resetPasswordInputSchema } from '@/modules/password-recovery/lib/reset-password-input-schema';

/** A valid strong password that satisfies the policy. */
const STRONG_PASSWORD = 'Forte!Senha9';

describe('resetPasswordInputSchema — happy path', () => {
  it('accepts a valid strong password with matching confirmation', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: STRONG_PASSWORD,
      passwordConfirm: STRONG_PASSWORD,
    });
    expect(result.success).toBe(true);
  });
});

describe('resetPasswordInputSchema — password policy violations', () => {
  it('rejects a password shorter than 10 characters', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: 'Ab1!xxxxx', // 9 chars
      passwordConfirm: 'Ab1!xxxxx',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a password missing uppercase', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: 'forte!senha9',
      passwordConfirm: 'forte!senha9',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a password missing lowercase', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: 'FORTE!SENHA9',
      passwordConfirm: 'FORTE!SENHA9',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a password missing a digit', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: 'Forte!Senha',
      passwordConfirm: 'Forte!Senha',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a password missing a special character', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: 'ForteSenha9',
      passwordConfirm: 'ForteSenha9',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('emits the pt-BR policy message for a weak password', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: 'fraca',
      passwordConfirm: 'fraca',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password).toContain(
      'A senha deve ter pelo menos 10 caracteres e conter letra maiúscula, minúscula, número e caractere especial.',
    );
  });
});

describe('resetPasswordInputSchema — password confirmation mismatch', () => {
  it('rejects mismatched passwords with the error on passwordConfirm', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: STRONG_PASSWORD,
      passwordConfirm: 'Forte!Senha8',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.passwordConfirm).toContain('As senhas não coincidem.');
    // Error should NOT appear on the password field itself
    expect(fieldErrors.password).toBeUndefined();
  });

  it('rejects an empty confirmation', () => {
    const result = resetPasswordInputSchema.safeParse({
      password: STRONG_PASSWORD,
      passwordConfirm: '',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.passwordConfirm).toContain('As senhas não coincidem.');
  });
});

describe('resetPasswordInputSchema — missing fields', () => {
  it('rejects missing password field entirely', () => {
    const result = resetPasswordInputSchema.safeParse({ passwordConfirm: STRONG_PASSWORD });
    expect(result.success).toBe(false);
  });

  it('rejects missing passwordConfirm field entirely', () => {
    const result = resetPasswordInputSchema.safeParse({ password: STRONG_PASSWORD });
    expect(result.success).toBe(false);
  });

  it('rejects an empty object', () => {
    const result = resetPasswordInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
