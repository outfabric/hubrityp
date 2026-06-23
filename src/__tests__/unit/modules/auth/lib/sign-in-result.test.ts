import { describe, expect, it } from 'vitest';

import {
  getSignInErrorMessage,
  SIGN_IN_ERROR_MESSAGES,
  type SignInError,
  type SignInResult,
} from '@/modules/auth/lib/sign-in-result';

// ---------------------------------------------------------------------------
// 6.5 — All 5 error types render correct copy via the mapping helper
// ---------------------------------------------------------------------------

const ALL_ERRORS: SignInError[] = [
  'invalid_credentials',
  'email_not_confirmed',
  'locked_out',
  'requires_password_reset',
  'account_unavailable',
  'unknown',
];

describe('SIGN_IN_ERROR_MESSAGES', () => {
  it('has an entry for every SignInError variant', () => {
    for (const error of ALL_ERRORS) {
      expect(SIGN_IN_ERROR_MESSAGES[error]).toBeDefined();
      expect(typeof SIGN_IN_ERROR_MESSAGES[error]).toBe('string');
      expect(SIGN_IN_ERROR_MESSAGES[error].length).toBeGreaterThan(0);
    }
  });

  it('invalid_credentials maps to the correct pt-BR copy', () => {
    expect(SIGN_IN_ERROR_MESSAGES.invalid_credentials).toBe('E-mail ou senha incorretos.');
  });

  it('email_not_confirmed maps to the correct pt-BR copy', () => {
    expect(SIGN_IN_ERROR_MESSAGES.email_not_confirmed).toContain('Confirme seu e-mail');
  });

  it('locked_out maps to the correct pt-BR copy', () => {
    expect(SIGN_IN_ERROR_MESSAGES.locked_out).toContain('bloqueada');
    expect(SIGN_IN_ERROR_MESSAGES.locked_out).toContain('excesso de tentativas');
  });

  it('requires_password_reset maps to the correct pt-BR copy', () => {
    expect(SIGN_IN_ERROR_MESSAGES.requires_password_reset).toContain('redefina sua senha');
  });

  it('account_unavailable maps to the correct pt-BR copy', () => {
    expect(SIGN_IN_ERROR_MESSAGES.account_unavailable).toContain('não está disponível');
    expect(SIGN_IN_ERROR_MESSAGES.account_unavailable).toContain('suporte');
  });

  it('unknown maps to the correct pt-BR copy', () => {
    expect(SIGN_IN_ERROR_MESSAGES.unknown).toContain('Algo deu errado');
  });
});

describe('getSignInErrorMessage', () => {
  it('returns null for a success result', () => {
    const result: SignInResult = { ok: true };
    expect(getSignInErrorMessage(result)).toBeNull();
  });

  it.each(ALL_ERRORS)('returns the correct message for error "%s"', (error) => {
    // Build the result with the right shape — locked_out may include lockoutUntil
    const result: SignInResult =
      error === 'locked_out'
        ? { ok: false, error: 'locked_out', lockoutUntil: '2026-01-01T00:00:00Z' }
        : { ok: false, error };
    expect(getSignInErrorMessage(result)).toBe(SIGN_IN_ERROR_MESSAGES[error]);
  });

  it('returns the message for locked_out without lockoutUntil', () => {
    const result: SignInResult = { ok: false, error: 'locked_out' };
    expect(getSignInErrorMessage(result)).toBe(SIGN_IN_ERROR_MESSAGES.locked_out);
  });
});
