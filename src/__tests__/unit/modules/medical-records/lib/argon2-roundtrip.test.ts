import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// argon2id hash/verify roundtrip
//
// These tests exercise the argon2 npm package with the same parameters the
// personal-notes server action uses (Decision #2 from design.md):
//   memoryCost=65536, timeCost=3, parallelism=4, hashLength=32
// ---------------------------------------------------------------------------

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};

describe('argon2id roundtrip', () => {
  it('hash then verify returns true for the same password', async () => {
    const password = 'minha-senha-secreta';
    const hash = await argon2.hash(password, ARGON2_OPTIONS);
    const isValid = await argon2.verify(hash, password);
    expect(isValid).toBe(true);
  });

  it('verify returns false for a wrong password', async () => {
    const hash = await argon2.hash('correct-password', ARGON2_OPTIONS);
    const isValid = await argon2.verify(hash, 'wrong-password');
    expect(isValid).toBe(false);
  });

  it('hash format starts with $argon2id$', async () => {
    const hash = await argon2.hash('test-password', ARGON2_OPTIONS);
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('different calls with the same password produce different hashes (random salt)', async () => {
    const password = 'same-password';
    const hash1 = await argon2.hash(password, ARGON2_OPTIONS);
    const hash2 = await argon2.hash(password, ARGON2_OPTIONS);
    expect(hash1).not.toBe(hash2);

    // Both should still verify correctly
    expect(await argon2.verify(hash1, password)).toBe(true);
    expect(await argon2.verify(hash2, password)).toBe(true);
  });

  it('hash includes the expected algorithm parameters', async () => {
    const hash = await argon2.hash('param-check', ARGON2_OPTIONS);
    // argon2id hash format: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=4');
  });
});
