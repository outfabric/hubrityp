import { describe, expect, it } from 'vitest';

import { generatePatientVideoUrl } from '@/modules/telepsicologia/lib/video-url';

describe('generatePatientVideoUrl', () => {
  const validToken = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

  // ------------------------------------------------------------------
  // Correct URL format
  // ------------------------------------------------------------------

  it('returns the correct URL format with baseUrl and token', () => {
    const url = generatePatientVideoUrl('https://app.hubrityp.com.br', validToken);

    expect(url).toBe(`https://app.hubrityp.com.br/v/${validToken}`);
  });

  it('handles baseUrl with trailing slash by stripping it', () => {
    const url = generatePatientVideoUrl('https://app.hubrityp.com.br/', validToken);

    expect(url).toBe(`https://app.hubrityp.com.br/v/${validToken}`);
  });

  it('produces the same URL regardless of trailing slash', () => {
    const withSlash = generatePatientVideoUrl('https://example.com/', validToken);
    const withoutSlash = generatePatientVideoUrl('https://example.com', validToken);

    expect(withSlash).toBe(withoutSlash);
  });

  it('works with a localhost baseUrl', () => {
    const url = generatePatientVideoUrl('http://localhost:3000', validToken);

    expect(url).toBe(`http://localhost:3000/v/${validToken}`);
  });

  it('accepts all-zero hex token', () => {
    const zeroToken = '0'.repeat(64);
    const url = generatePatientVideoUrl('https://app.example.com', zeroToken);

    expect(url).toBe(`https://app.example.com/v/${zeroToken}`);
  });

  it('accepts all-f hex token', () => {
    const fToken = 'f'.repeat(64);
    const url = generatePatientVideoUrl('https://app.example.com', fToken);

    expect(url).toBe(`https://app.example.com/v/${fToken}`);
  });

  // ------------------------------------------------------------------
  // Invalid token — non-hex characters
  // ------------------------------------------------------------------

  it('throws on a token with uppercase hex characters', () => {
    const upperToken = 'A'.repeat(64);

    expect(() => generatePatientVideoUrl('https://example.com', upperToken)).toThrow(
      /Invalid patient token/,
    );
  });

  it('throws on a token with non-hex characters (g)', () => {
    const badToken = 'g'.repeat(64);

    expect(() => generatePatientVideoUrl('https://example.com', badToken)).toThrow(
      /Invalid patient token/,
    );
  });

  it('throws on a token with special characters', () => {
    const specialToken = '!@#$%^&*'.repeat(8);

    expect(() => generatePatientVideoUrl('https://example.com', specialToken)).toThrow(
      /Invalid patient token/,
    );
  });

  // ------------------------------------------------------------------
  // Invalid token — wrong length
  // ------------------------------------------------------------------

  it('throws on a token shorter than 64 characters', () => {
    const shortToken = 'a'.repeat(63);

    expect(() => generatePatientVideoUrl('https://example.com', shortToken)).toThrow(
      /Invalid patient token/,
    );
  });

  it('throws on a token longer than 64 characters', () => {
    const longToken = 'a'.repeat(65);

    expect(() => generatePatientVideoUrl('https://example.com', longToken)).toThrow(
      /Invalid patient token/,
    );
  });

  it('throws on an empty token', () => {
    expect(() => generatePatientVideoUrl('https://example.com', '')).toThrow(
      /Invalid patient token/,
    );
  });

  // ------------------------------------------------------------------
  // Error message includes diagnostic info
  // ------------------------------------------------------------------

  it('includes the token length in the error message', () => {
    const shortToken = 'abc';

    expect(() => generatePatientVideoUrl('https://example.com', shortToken)).toThrow(/length 3/);
  });

  it('truncates long invalid tokens in the error message', () => {
    const longBadToken = 'x'.repeat(200);

    expect(() => generatePatientVideoUrl('https://example.com', longBadToken)).toThrow(/\.\.\./);
  });
});
