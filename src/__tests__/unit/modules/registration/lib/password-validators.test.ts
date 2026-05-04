import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_LENGTH,
  passwordPolicy,
  type PasswordRule,
} from '@/modules/registration/lib/password-validators';

describe('passwordPolicy — happy paths', () => {
  it('returns ok=true with empty missing array for a fully compliant password', () => {
    const result = passwordPolicy('Forte!Senha9');
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('accepts the minimum-length password that satisfies every rule', () => {
    // Exactly PASSWORD_MIN_LENGTH (10) chars, with all required classes.
    const value = 'Aa1!aaaaaa';
    expect(value.length).toBe(PASSWORD_MIN_LENGTH);
    expect(passwordPolicy(value)).toEqual({ ok: true, missing: [] });
  });

  it('accepts longer passwords without flagging length', () => {
    const result = passwordPolicy('Senha-Muito-Forte!2026');
    expect(result.ok).toBe(true);
    expect(result.missing).not.toContain('length');
  });

  it('accepts a variety of allowed special characters', () => {
    const specials = [
      '!',
      '@',
      '#',
      '$',
      '%',
      '^',
      '&',
      '*',
      '(',
      ')',
      '_',
      '+',
      '-',
      '=',
      '[',
      ']',
      '{',
      '}',
      '|',
      ';',
      ':',
      ',',
      '.',
      '<',
      '>',
      '?',
    ];
    for (const ch of specials) {
      const password = `Aa1aaaaaa${ch}`; // 10 chars: 1U, 7L, 1D, 1S
      const result = passwordPolicy(password);
      expect(result.ok, `expected ok for special "${ch}" in "${password}"`).toBe(true);
    }
  });
});

describe('passwordPolicy — single-rule failures (each class isolated)', () => {
  it('only "length" missing when password is short but otherwise complete', () => {
    // 7 chars: uppercase, lowercase, digit, special — only length fails.
    const result = passwordPolicy('Forte!9');
    expect(result).toEqual({ ok: false, missing: ['length'] });
  });

  it('only "length" missing when password is exactly PASSWORD_MIN_LENGTH - 1 chars', () => {
    const value = 'Aa1!aaaaa'; // 9 chars, all classes present
    expect(value.length).toBe(PASSWORD_MIN_LENGTH - 1);
    expect(passwordPolicy(value)).toEqual({ ok: false, missing: ['length'] });
  });

  it('only "uppercase" missing when password has length, lowercase, digit, special', () => {
    const result = passwordPolicy('senhaforte!9');
    expect(result).toEqual({ ok: false, missing: ['uppercase'] });
  });

  it('only "lowercase" missing when password has length, uppercase, digit, special', () => {
    const result = passwordPolicy('SENHAFORTE!9');
    expect(result).toEqual({ ok: false, missing: ['lowercase'] });
  });

  it('only "digit" missing when password has length, uppercase, lowercase, special', () => {
    const result = passwordPolicy('SenhaForte!');
    expect(result).toEqual({ ok: false, missing: ['digit'] });
  });

  it('only "special" missing when password has length, uppercase, lowercase, digit', () => {
    const result = passwordPolicy('SenhaForte9');
    expect(result).toEqual({ ok: false, missing: ['special'] });
  });
});

describe('passwordPolicy — combined failures with canonical ordering', () => {
  it('returns missing in order [length, uppercase, lowercase, digit, special] — order check', () => {
    // Empty string fails everything; canonical order must be respected.
    const result = passwordPolicy('');
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual<PasswordRule[]>([
      'length',
      'uppercase',
      'lowercase',
      'digit',
      'special',
    ]);
  });

  it('lowercase-only password (length OK) reports uppercase, digit, special — in canonical order', () => {
    // 10 lowercase letters: length OK, lowercase OK; missing the other three.
    const result = passwordPolicy('aaaaaaaaaa');
    expect(result).toEqual<{ ok: boolean; missing: PasswordRule[] }>({
      ok: false,
      missing: ['uppercase', 'digit', 'special'],
    });
  });

  it('reports length+uppercase+lowercase missing for short numeric+special password', () => {
    const result = passwordPolicy('123!@#'); // 6 chars, no uppercase, no lowercase
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual<PasswordRule[]>(['length', 'uppercase', 'lowercase']);
  });

  it('reports digit+special missing for long mixed-case alphabetic password', () => {
    const result = passwordPolicy('SenhaSemNumero');
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual<PasswordRule[]>(['digit', 'special']);
  });

  it('reports length+digit+special for short mixed-case alphabetic password', () => {
    const result = passwordPolicy('Curta');
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual<PasswordRule[]>(['length', 'digit', 'special']);
  });
});

describe('passwordPolicy — boundary values', () => {
  it('whitespace at length still counts toward length', () => {
    // 10 spaces: length OK, but uppercase/lowercase/digit/special all fail.
    const result = passwordPolicy('          ');
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual<PasswordRule[]>(['uppercase', 'lowercase', 'digit', 'special']);
  });

  it('PASSWORD_MIN_LENGTH constant equals 10', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });
});
