import { describe, expect, it } from 'vitest';

import { phoneNumberSchema } from '@/modules/whatsapp/lib/phone-number-schema';

// ---------------------------------------------------------------------------
// Valid phone numbers
// ---------------------------------------------------------------------------

describe('phoneNumberSchema — valid numbers', () => {
  it('accepts a valid Brazilian mobile number', () => {
    const result = phoneNumberSchema.safeParse('+5511987654321');
    expect(result.success).toBe(true);
  });

  it('accepts an international number (Portugal)', () => {
    const result = phoneNumberSchema.safeParse('+351912345678');
    expect(result.success).toBe(true);
  });

  it('accepts a maximum-length E.164 number (15 digits)', () => {
    // +1 followed by 14 more digits = 15 total
    const result = phoneNumberSchema.safeParse('+123456789012345');
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid phone numbers
// ---------------------------------------------------------------------------

describe('phoneNumberSchema — invalid numbers', () => {
  it('rejects a number without country code prefix', () => {
    const result = phoneNumberSchema.safeParse('11987654321');
    expect(result.success).toBe(false);
  });

  it('rejects a number without area code', () => {
    const result = phoneNumberSchema.safeParse('987654321');
    expect(result.success).toBe(false);
  });

  it('rejects a number starting with +0', () => {
    const result = phoneNumberSchema.safeParse('+0111234567');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = phoneNumberSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects a bare country code (+55)', () => {
    const result = phoneNumberSchema.safeParse('+55');
    expect(result.success).toBe(false);
  });

  it('rejects alphabetic input', () => {
    const result = phoneNumberSchema.safeParse('abc');
    expect(result.success).toBe(false);
  });

  it('rejects a number exceeding E.164 max length (16 digits)', () => {
    const result = phoneNumberSchema.safeParse('+1234567890123456');
    expect(result.success).toBe(false);
  });

  it('provides the correct pt-BR error message', () => {
    const result = phoneNumberSchema.safeParse('invalido');
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = result.error.issues[0]?.message;
    expect(message).toBe('Telefone inválido. Use o formato +55 (DD) NNNNN-NNNN.');
  });
});
