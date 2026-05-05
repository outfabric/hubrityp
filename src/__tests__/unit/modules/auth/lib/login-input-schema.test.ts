import { describe, expect, it } from 'vitest';

import { loginInputSchema } from '@/modules/auth/lib/login-input-schema';

describe('loginInputSchema', () => {
  it('accepts a valid email and an 8-character password', () => {
    const result = loginInputSchema.safeParse({
      email: 'a@b.co',
      password: '12345678',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a longer password', () => {
    const result = loginInputSchema.safeParse({
      email: 'psicologo@example.com',
      password: 'long-enough-password',
    });

    expect(result.success).toBe(true);
  });

  it('rejects empty fields with errors on both email and password', () => {
    const result = loginInputSchema.safeParse({ email: '', password: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email?.length ?? 0).toBeGreaterThan(0);
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a password shorter than 8 characters with an error on the password field', () => {
    const result = loginInputSchema.safeParse({
      email: 'a@b.co',
      password: 'short',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
    expect(fieldErrors.email).toBeUndefined();
  });

  it('rejects a malformed email with an error on the email field', () => {
    const result = loginInputSchema.safeParse({
      email: 'not-an-email',
      password: '12345678',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email?.length ?? 0).toBeGreaterThan(0);
    expect(fieldErrors.password).toBeUndefined();
  });

  it('rejects missing fields entirely', () => {
    const result = loginInputSchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email?.length ?? 0).toBeGreaterThan(0);
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('emits the pt-BR message for a malformed email', () => {
    const result = loginInputSchema.safeParse({
      email: 'not-an-email',
      password: '12345678',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email).toContain('E-mail inválido.');
  });

  it('emits the pt-BR message for a too-short password', () => {
    const result = loginInputSchema.safeParse({
      email: 'a@b.co',
      password: 'short',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password).toContain('A senha deve ter pelo menos 8 caracteres.');
  });

  it('emits the pt-BR "informe seu e-mail" message for an empty email', () => {
    const result = loginInputSchema.safeParse({ email: '', password: '12345678' });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email).toContain('Informe seu e-mail.');
  });

  describe('keepLoggedIn field', () => {
    it('defaults keepLoggedIn to false when not provided', () => {
      const result = loginInputSchema.safeParse({
        email: 'a@b.co',
        password: '12345678',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.keepLoggedIn).toBe(false);
    });

    it('accepts keepLoggedIn: true', () => {
      const result = loginInputSchema.safeParse({
        email: 'a@b.co',
        password: '12345678',
        keepLoggedIn: true,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.keepLoggedIn).toBe(true);
    });

    it('accepts keepLoggedIn: false explicitly', () => {
      const result = loginInputSchema.safeParse({
        email: 'a@b.co',
        password: '12345678',
        keepLoggedIn: false,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.keepLoggedIn).toBe(false);
    });

    it('rejects a non-boolean keepLoggedIn value (string)', () => {
      const result = loginInputSchema.safeParse({
        email: 'a@b.co',
        password: '12345678',
        keepLoggedIn: 'true',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.keepLoggedIn?.length ?? 0).toBeGreaterThan(0);
    });

    it('rejects a non-boolean keepLoggedIn value (number)', () => {
      const result = loginInputSchema.safeParse({
        email: 'a@b.co',
        password: '12345678',
        keepLoggedIn: 1,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.keepLoggedIn?.length ?? 0).toBeGreaterThan(0);
    });
  });
});
