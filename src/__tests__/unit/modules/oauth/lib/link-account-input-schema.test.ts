import { describe, expect, it } from 'vitest';

import { linkAccountInputSchema } from '@/modules/oauth/lib/link-account-input-schema';

describe('linkAccountInputSchema — happy path', () => {
  it('accepts a valid password and UUID pendingUserId', () => {
    const result = linkAccountInputSchema.safeParse({
      password: 'mypassword123',
      pendingUserId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });
});

describe('linkAccountInputSchema — password validation', () => {
  it('rejects an empty password', () => {
    const result = linkAccountInputSchema.safeParse({
      password: '',
      pendingUserId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
    expect(fieldErrors.password).toContain('Informe sua senha.');
  });

  it('rejects a missing password field', () => {
    const result = linkAccountInputSchema.safeParse({
      pendingUserId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts a single-character password (min(1))', () => {
    const result = linkAccountInputSchema.safeParse({
      password: 'x',
      pendingUserId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });
});

describe('linkAccountInputSchema — pendingUserId validation', () => {
  it('rejects a non-UUID string', () => {
    const result = linkAccountInputSchema.safeParse({
      password: 'mypassword',
      pendingUserId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.pendingUserId?.length ?? 0).toBeGreaterThan(0);
    expect(fieldErrors.pendingUserId).toContain('ID do usuário pendente inválido.');
  });

  it('rejects an empty pendingUserId', () => {
    const result = linkAccountInputSchema.safeParse({
      password: 'mypassword',
      pendingUserId: '',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.pendingUserId?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a missing pendingUserId field', () => {
    const result = linkAccountInputSchema.safeParse({
      password: 'mypassword',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.pendingUserId?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts a valid v4 UUID', () => {
    const result = linkAccountInputSchema.safeParse({
      password: 'mypassword',
      pendingUserId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    });
    expect(result.success).toBe(true);
  });
});
