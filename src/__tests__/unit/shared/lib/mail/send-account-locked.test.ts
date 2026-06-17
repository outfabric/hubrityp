import { describe, expect, it } from 'vitest';

import { buildHtml, buildText } from '@/shared/lib/mail/send-account-locked';

const RECIPIENT = 'user@example.com';

describe('account-locked email builder', () => {
  describe('HTML part', () => {
    const html = buildHtml(RECIPIENT);

    it('signs off as "— Equipe Hubrity"', () => {
      expect(html).toContain('— Equipe Hubrity');
    });

    it('carries no legacy HubrityP branding', () => {
      expect(html).not.toContain('HubrityP');
    });
  });

  describe('text part', () => {
    const text = buildText(RECIPIENT);

    it('signs off as "— Equipe Hubrity"', () => {
      expect(text).toContain('— Equipe Hubrity');
    });

    it('carries no legacy HubrityP branding', () => {
      expect(text).not.toContain('HubrityP');
    });
  });
});
