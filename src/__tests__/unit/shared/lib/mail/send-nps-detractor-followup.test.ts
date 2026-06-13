import { describe, expect, it } from 'vitest';

import { buildHtml, buildText } from '@/shared/lib/mail/send-nps-detractor-followup';

describe('nps-detractor-followup email builder', () => {
  describe('HTML part', () => {
    const html = buildHtml();

    it('references the recent experience with Hubrity', () => {
      expect(html).toContain('sua experiência recente com o Hubrity');
    });

    it('signs off as "— Equipe Hubrity"', () => {
      expect(html).toContain('— Equipe Hubrity');
    });

    it('carries no legacy HubrityP branding', () => {
      expect(html).not.toContain('HubrityP');
    });
  });

  describe('text part', () => {
    const text = buildText();

    it('references the recent experience with Hubrity', () => {
      expect(text).toContain('sua experiência recente com o Hubrity');
    });

    it('signs off as "— Equipe Hubrity"', () => {
      expect(text).toContain('— Equipe Hubrity');
    });

    it('carries no legacy HubrityP branding', () => {
      expect(text).not.toContain('HubrityP');
    });
  });
});
