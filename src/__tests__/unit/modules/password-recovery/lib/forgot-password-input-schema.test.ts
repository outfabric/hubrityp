import { describe, expect, it } from 'vitest';

import { forgotPasswordInputSchema } from '@/modules/password-recovery/lib/forgot-password-input-schema';

describe('forgotPasswordInputSchema', () => {
  it('accepts a valid email', () => {
    const result = forgotPasswordInputSchema.safeParse({ email: 'psicologo@example.com' });
    expect(result.success).toBe(true);
  });

  it('accepts a minimal valid email', () => {
    const result = forgotPasswordInputSchema.safeParse({ email: 'a@b.co' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty email', () => {
    const result = forgotPasswordInputSchema.safeParse({ email: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a malformed email (no @ sign)', () => {
    const result = forgotPasswordInputSchema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email).toContain('E-mail inválido.');
  });

  it('rejects a malformed email (no domain)', () => {
    const result = forgotPasswordInputSchema.safeParse({ email: 'user@' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email).toContain('E-mail inválido.');
  });

  it('rejects a missing email field entirely', () => {
    const result = forgotPasswordInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email?.length ?? 0).toBeGreaterThan(0);
  });

  it('emits the pt-BR "informe seu e-mail" message for an empty email', () => {
    const result = forgotPasswordInputSchema.safeParse({ email: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.email).toContain('Informe seu e-mail.');
  });
});
