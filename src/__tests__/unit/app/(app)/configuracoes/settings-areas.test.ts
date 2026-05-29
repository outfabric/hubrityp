import { Sparkles } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { BREADCRUMB_LABELS } from '@/app/(app)/configuracoes/breadcrumb-labels';
import { SETTINGS_AREAS } from '@/app/(app)/configuracoes/settings-areas';

describe('SETTINGS_AREAS', () => {
  it('has exactly 5 entries', () => {
    expect(SETTINGS_AREAS).toHaveLength(5);
  });

  it('every entry has non-empty label, description, href, and slug', () => {
    for (const area of SETTINGS_AREAS) {
      expect(area.label).toBeTruthy();
      expect(area.description).toBeTruthy();
      expect(area.href).toBeTruthy();
      expect(area.slug).toBeTruthy();
    }
  });

  it('every href starts with /configuracoes', () => {
    for (const area of SETTINGS_AREAS) {
      expect(area.href).toMatch(/^\/configuracoes/);
    }
  });

  it('all slugs are unique', () => {
    const slugs = SETTINGS_AREAS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every icon is a valid Lucide component (React forwardRef)', () => {
    for (const area of SETTINGS_AREAS) {
      // Lucide v0.460+ exports forwardRef objects with a render function
      expect(area.icon).toBeDefined();
      expect(typeof area.icon).toSatisfy((t: string) => t === 'function' || t === 'object');
    }
  });

  it('entries are in the expected order', () => {
    const labels = SETTINGS_AREAS.map((a) => a.label);
    expect(labels).toEqual([
      'Locais de atendimento',
      'WhatsApp',
      'Lembretes',
      'Agenda',
      'Transcrição IA',
    ]);
  });

  it('includes the "transcricao-ia" entry with the Sparkles icon and correct href', () => {
    const entry = SETTINGS_AREAS.find((a) => a.slug === 'transcricao-ia');

    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Transcrição IA');
    expect(entry?.description).toBe(
      'Ativar a feature, escolher template padrão, sensibilidade de risco e ver estatísticas.',
    );
    expect(entry?.href).toBe('/configuracoes/transcricao-ia');
    expect(entry?.icon).toBe(Sparkles);
  });

  it('every settings-area slug has a corresponding breadcrumb label', () => {
    for (const area of SETTINGS_AREAS) {
      expect(
        BREADCRUMB_LABELS[area.slug],
        `Missing breadcrumb label for settings-area slug "${area.slug}"`,
      ).toBeDefined();
    }
  });
});
