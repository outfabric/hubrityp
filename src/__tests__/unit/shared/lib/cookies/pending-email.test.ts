import { createHmac } from 'node:crypto';

import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';
import { describe, expect, it, vi } from 'vitest';

import {
  PENDING_EMAIL_COOKIE_NAME,
  PENDING_EMAIL_MAX_AGE,
  clearPendingEmailCookie,
  maskEmail,
  readPendingEmail,
  setPendingEmailCookie,
} from '@/shared/lib/cookies/pending-email';

// Mirrors the value seeded by vitest.setup.ts so the test can forge a
// wrong-secret signature deterministically.
const SECRET = 'unit-test-pending-email-cookie-secret-min-32-chars';

type CapturedSet = {
  name: string;
  value: string;
  options: Partial<ResponseCookie> | undefined;
};

/** A minimal in-memory cookie store that records every `set` call. */
function makeWriteStore() {
  const calls: CapturedSet[] = [];
  return {
    calls,
    set: (name: string, value: string, options?: Partial<ResponseCookie>) => {
      calls.push({ name, value, options });
    },
    /** Return the single recorded `set` call, asserting exactly one happened. */
    only(): CapturedSet {
      expect(calls).toHaveLength(1);
      const call = calls[0];
      if (!call) throw new Error('expected a recorded set() call');
      return call;
    },
  };
}

/** A minimal read store backed by a fixed map. */
function makeReadStore(value: string | undefined) {
  return {
    get: vi.fn((name: string) =>
      name === PENDING_EMAIL_COOKIE_NAME && value !== undefined ? { value } : undefined,
    ),
  };
}

describe('pending-email cookie', () => {
  describe('round-trip set -> read', () => {
    it('reads back the exact email that was set', () => {
      const writeStore = makeWriteStore();
      setPendingEmailCookie(writeStore, 'maria@gmail.com');

      const written = writeStore.only();
      expect(written.name).toBe(PENDING_EMAIL_COOKIE_NAME);

      const readStore = makeReadStore(written.value);
      expect(readPendingEmail(readStore)).toBe('maria@gmail.com');
    });

    it('round-trips an email with non-ASCII characters', () => {
      const writeStore = makeWriteStore();
      setPendingEmailCookie(writeStore, 'joão.müller@exâmple.com');

      const readStore = makeReadStore(writeStore.only().value);
      expect(readPendingEmail(readStore)).toBe('joão.müller@exâmple.com');
    });
  });

  describe('rejection of forged / tampered values', () => {
    it('returns null for a missing cookie', () => {
      expect(readPendingEmail(makeReadStore(undefined))).toBeNull();
    });

    it('returns null for a malformed value (no separator)', () => {
      expect(readPendingEmail(makeReadStore('not-a-valid-cookie'))).toBeNull();
    });

    it('returns null when the signature is tampered', () => {
      const writeStore = makeWriteStore();
      setPendingEmailCookie(writeStore, 'maria@gmail.com');
      const original = writeStore.only().value;
      const [encoded] = original.split('.');
      const tampered = `${encoded}.deadbeefdeadbeefdeadbeef`;

      expect(readPendingEmail(makeReadStore(tampered))).toBeNull();
    });

    it('returns null when the email payload is swapped but the signature is kept', () => {
      const writeStore = makeWriteStore();
      setPendingEmailCookie(writeStore, 'maria@gmail.com');
      const [, signature] = writeStore.only().value.split('.');
      const forgedEmail = Buffer.from('attacker@evil.com', 'utf8').toString('base64url');

      expect(readPendingEmail(makeReadStore(`${forgedEmail}.${signature}`))).toBeNull();
    });

    it('returns null for a signature produced with the wrong secret', () => {
      const email = 'maria@gmail.com';
      const encoded = Buffer.from(email, 'utf8').toString('base64url');
      const wrongSignature = createHmac('sha256', `${SECRET}-WRONG`)
        .update(email, 'utf8')
        .digest('base64url');

      expect(readPendingEmail(makeReadStore(`${encoded}.${wrongSignature}`))).toBeNull();
    });
  });

  describe('cookie hardening', () => {
    it('sets hardened options with the configured Max-Age on write', () => {
      const writeStore = makeWriteStore();
      setPendingEmailCookie(writeStore, 'maria@gmail.com');

      const { options } = writeStore.only();
      expect(options).toMatchObject({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: PENDING_EMAIL_MAX_AGE,
      });
      // `secure` is environment-dependent (true in prod) but must always be a
      // boolean — never omitted.
      expect(typeof options?.secure).toBe('boolean');
      expect(PENDING_EMAIL_MAX_AGE).toBe(1_800);
    });

    it('clears the cookie with Max-Age=0 and hardened options', () => {
      const writeStore = makeWriteStore();
      clearPendingEmailCookie(writeStore);

      const { name, value, options } = writeStore.only();
      expect(name).toBe(PENDING_EMAIL_COOKIE_NAME);
      expect(value).toBe('');
      expect(options).toMatchObject({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 0,
      });
    });
  });

  describe('maskEmail', () => {
    it('keeps the first local char and the full domain, masking the rest', () => {
      expect(maskEmail('maria@gmail.com')).toBe('m****@gmail.com');
    });

    it('never leaks any local-part character beyond the first', () => {
      const masked = maskEmail('sensitive.user@hubrity.com');
      expect(masked.startsWith('s')).toBe(true);
      expect(masked.endsWith('@hubrity.com')).toBe(true);
      // None of the remaining local-part characters survive.
      expect(masked).not.toContain('ensitive.user');
      expect(masked).toBe('s*************@hubrity.com');
    });

    it('preserves the full domain verbatim', () => {
      expect(maskEmail('a@sub.example.co.uk')).toBe('a@sub.example.co.uk');
    });

    it('masks a single-char local part to just that char + domain', () => {
      expect(maskEmail('x@gmail.com')).toBe('x@gmail.com');
    });
  });
});
