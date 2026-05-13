import { describe, expect, it } from 'vitest';

import { BREADCRUMB_LABELS } from '@/app/(app)/configuracoes/breadcrumb-labels';
import { INTEGRATIONS } from '@/app/(app)/configuracoes/integracoes/integrations';
import { SETTINGS_AREAS } from '@/app/(app)/configuracoes/settings-areas';

describe('BREADCRUMB_LABELS', () => {
  it('has correct diacritics on "Configurações"', () => {
    expect(BREADCRUMB_LABELS['configuracoes']).toBe('Configurações');
  });

  it('has correct diacritics on "Integrações"', () => {
    expect(BREADCRUMB_LABELS['integracoes']).toBe('Integrações');
  });

  it('has correct cedilla on "Histórico"', () => {
    expect(BREADCRUMB_LABELS['historico']).toBe('Histórico');
  });

  it('every URL segment used in SETTINGS_AREAS has a breadcrumb label', () => {
    for (const area of SETTINGS_AREAS) {
      // Extract all path segments from the href (skip empty first segment)
      const segments = area.href.split('/').filter(Boolean);
      for (const segment of segments) {
        expect(
          BREADCRUMB_LABELS[segment],
          `Missing breadcrumb label for segment "${segment}" (from href "${area.href}")`,
        ).toBeDefined();
      }
    }
  });

  it('every URL segment used in INTEGRATIONS has a breadcrumb label', () => {
    for (const integration of INTEGRATIONS) {
      const segments = integration.href.split('/').filter(Boolean);
      for (const segment of segments) {
        expect(
          BREADCRUMB_LABELS[segment],
          `Missing breadcrumb label for segment "${segment}" (from href "${integration.href}")`,
        ).toBeDefined();
      }
    }
  });
});
