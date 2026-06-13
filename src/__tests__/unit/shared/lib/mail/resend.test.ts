import { describe, expect, it } from 'vitest';

import { DEFAULT_FROM } from '@/shared/lib/mail/resend';

describe('resend DEFAULT_FROM', () => {
  it('uses the Hubrity display name', () => {
    expect(DEFAULT_FROM).toContain('Hubrity <');
  });

  it('uses the hubrity.com sender domain', () => {
    expect(DEFAULT_FROM).toContain('noreply@hubrity.com');
  });

  it('carries no legacy HubrityP branding or domain', () => {
    expect(DEFAULT_FROM).not.toContain('HubrityP');
    expect(DEFAULT_FROM).not.toContain('hubrityp.com');
  });
});
