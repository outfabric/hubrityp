import { describe, expect, it } from 'vitest';

import {
  buildConsentUrl,
  buildConsentWhatsAppHref,
  extractPhoneDigits,
} from '@/modules/patients/lib/consent-share';

describe('extractPhoneDigits', () => {
  it('strips formatting characters, keeping only digits', () => {
    expect(extractPhoneDigits('+55 (11) 99876-5432')).toBe('5511998765432');
  });

  it('returns an empty string when there are no digits', () => {
    expect(extractPhoneDigits('no-digits-here')).toBe('');
  });

  it('returns digits unchanged when already clean', () => {
    expect(extractPhoneDigits('5511998765432')).toBe('5511998765432');
  });
});

describe('buildConsentUrl', () => {
  it('joins origin and token into the /termo/<token> path', () => {
    expect(buildConsentUrl('https://app.hubrityp.com', 'tok-123')).toBe(
      'https://app.hubrityp.com/termo/tok-123',
    );
  });
});

describe('buildConsentWhatsAppHref', () => {
  it('builds a wa.me href with the digits and the URL-encoded canonical message', () => {
    const consentUrl = 'https://app.hubrityp.com/termo/tok-123';
    const href = buildConsentWhatsAppHref('+55 (11) 99876-5432', consentUrl);

    const message = `Olá! Segue o link para assinatura do termo de consentimento: ${consentUrl}`;
    expect(href).toBe(`https://wa.me/5511998765432?text=${encodeURIComponent(message)}`);
  });

  it('includes the consent URL inside the decoded message', () => {
    const consentUrl = 'https://app.hubrityp.com/termo/tok-456';
    const href = buildConsentWhatsAppHref('11999998888', consentUrl);

    const encoded = href.split('?text=')[1]!;
    expect(decodeURIComponent(encoded)).toContain(consentUrl);
  });
});
