import { describe, expect, it } from 'vitest';

import { SETTINGS_AREAS } from '@/app/(app)/configuracoes/settings-areas';

describe('SETTINGS_AREAS', () => {
  it('has exactly 4 entries', () => {
    expect(SETTINGS_AREAS).toHaveLength(4);
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
    expect(labels).toEqual(['Locais de atendimento', 'WhatsApp', 'Lembretes', 'Agenda']);
  });
});
