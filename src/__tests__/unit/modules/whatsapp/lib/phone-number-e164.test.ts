import { describe, expect, it } from 'vitest';

import { toE164 } from '@/modules/whatsapp/lib/phone-number-e164';

describe('toE164', () => {
  it('normalizes a masked BR number to E.164', () => {
    expect(toE164('+55 86 99578-3867')).toBe('+5586995783867');
  });

  it('is idempotent for a value already in E.164', () => {
    expect(toE164('+5586995783867')).toBe('+5586995783867');
  });

  it('strips stray formatting and parentheses to a single + and digits', () => {
    expect(toE164('+55 (86) 99578-3867')).toBe('+5586995783867');
  });

  it('strips a "whatsapp:" address fragment down to the E.164 digits', () => {
    expect(toE164('whatsapp:+5586995783867')).toBe('+5586995783867');
  });

  it('returns null for an empty string', () => {
    expect(toE164('')).toBeNull();
  });

  it('returns null when there are too few digits', () => {
    expect(toE164('+55 123')).toBeNull();
  });

  it('returns null when the first digit is a leading zero', () => {
    expect(toE164('+0 86 99578-3867')).toBeNull();
  });

  it('returns null for letters-only input', () => {
    expect(toE164('not-a-phone')).toBeNull();
  });
});
