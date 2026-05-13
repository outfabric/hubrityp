import { describe, expect, it } from 'vitest';

import { INTEGRATIONS } from '@/app/(app)/configuracoes/integracoes/integrations';

describe('INTEGRATIONS', () => {
  it('has exactly 1 entry (WhatsApp) in v1', () => {
    expect(INTEGRATIONS).toHaveLength(1);
  });

  it('the sole entry is WhatsApp with correct shape', () => {
    const whatsapp = INTEGRATIONS[0]!;
    expect(whatsapp.label).toBe('WhatsApp');
    expect(whatsapp.slug).toBe('whatsapp');
    expect(whatsapp.description).toBe('Conecte sua conta para enviar lembretes e mensagens.');
  });

  it('href starts with /configuracoes', () => {
    expect(INTEGRATIONS[0]!.href).toMatch(/^\/configuracoes/);
  });

  it('href points to the whatsapp integration page', () => {
    expect(INTEGRATIONS[0]!.href).toBe('/configuracoes/integracoes/whatsapp');
  });

  it('icon is a valid Lucide component (React forwardRef)', () => {
    const icon = INTEGRATIONS[0]!.icon;
    expect(icon).toBeDefined();
    expect(typeof icon).toSatisfy((t: string) => t === 'function' || t === 'object');
  });
});
