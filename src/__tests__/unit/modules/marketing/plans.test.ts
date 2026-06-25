import { describe, expect, it } from 'vitest';

import {
  PLANS,
  FEATURE_KEYS,
  PRICING_SUPPORT_EMAIL,
  planSlugSchema,
  emptyPlansFallback,
  type Plan,
} from '@/modules/marketing/lib/plans';

// Features that are exclusive to the Avançado plan in the MVP. Everything else
// must be identical between the two plans (Essencial ⊂ Avançado).
const AVANCADO_EXCLUSIVE = ['lembretes_whatsapp', 'transcricao_ia'] as const;

// Post-MVP features that MUST NOT appear (as available) on the pricing surface.
// The literals here mirror what marketing might be tempted to add early; the
// guard is structural (no key outside FEATURE_KEYS) plus this explicit denylist.
const POST_MVP_FEATURE_HINTS = [
  'pix',
  'cobranca',
  'billing',
  'receita_saude',
  'recibo',
  'reembolso',
];

function included(plan: Plan): Set<string> {
  return new Set(plan.features.filter((f) => f.included).map((f) => f.key));
}

describe('plans config', () => {
  it('validates at module load and exposes exactly 2 plans', () => {
    // Importing the module already ran `plansSchema.parse`; reaching this line
    // proves validation passed.
    expect(PLANS).toHaveLength(2);
  });

  it('defines Essencial at R$60/mês (6000 cents) with no badge', () => {
    const essencial = PLANS.find((p) => p.slug === 'essencial');
    expect(essencial).toBeDefined();
    expect(essencial?.name).toBe('Essencial');
    expect(essencial?.priceCents).toBe(6000);
    expect(essencial?.badge).toBeUndefined();
  });

  it('defines Avançado at R$90/mês (9000 cents) flagged "Mais popular"', () => {
    const avancado = PLANS.find((p) => p.slug === 'avancado');
    expect(avancado).toBeDefined();
    expect(avancado?.name).toBe('Avançado');
    expect(avancado?.priceCents).toBe(9000);
    expect(avancado?.badge).toBe('Mais popular');
  });

  it('stores prices as positive integer cents (no floats)', () => {
    for (const plan of PLANS) {
      expect(Number.isInteger(plan.priceCents)).toBe(true);
      expect(plan.priceCents).toBeGreaterThan(0);
    }
  });

  it('lists every feature key exactly once per plan', () => {
    for (const plan of PLANS) {
      const keys = plan.features.map((f) => f.key);
      expect(keys).toHaveLength(FEATURE_KEYS.length);
      expect(new Set(keys).size).toBe(FEATURE_KEYS.length);
      expect([...keys].sort()).toEqual([...FEATURE_KEYS].sort());
    }
  });

  it('keeps Essencial as a subset of Avançado (Essencial ⊂ Avançado)', () => {
    const essencial = PLANS.find((p) => p.slug === 'essencial')!;
    const avancado = PLANS.find((p) => p.slug === 'avancado')!;
    const essIncluded = included(essencial);
    const avIncluded = included(avancado);

    // Every feature Essencial includes is also included by Avançado.
    for (const key of essIncluded) {
      expect(avIncluded.has(key)).toBe(true);
    }
    // Avançado has strictly more features.
    expect(avIncluded.size).toBeGreaterThan(essIncluded.size);
  });

  it('makes only WhatsApp + IA exclusive to Avançado', () => {
    const essencial = PLANS.find((p) => p.slug === 'essencial')!;
    const avancado = PLANS.find((p) => p.slug === 'avancado')!;
    const essIncluded = included(essencial);
    const avIncluded = included(avancado);

    // The features in Avançado but not in Essencial are exactly WhatsApp + IA.
    const exclusive = [...avIncluded].filter((key) => !essIncluded.has(key)).sort();
    expect(exclusive).toEqual([...AVANCADO_EXCLUSIVE].sort());

    // And those two are genuinely absent from Essencial.
    for (const key of AVANCADO_EXCLUSIVE) {
      expect(essIncluded.has(key)).toBe(false);
      expect(avIncluded.has(key)).toBe(true);
    }
  });

  it('does not surface any post-MVP feature as available', () => {
    const allKeys = PLANS.flatMap((p) => p.features.map((f) => f.key));
    for (const hint of POST_MVP_FEATURE_HINTS) {
      expect(allKeys.some((key) => key.includes(hint))).toBe(false);
    }
    // No feature key escapes the MVP allowlist.
    for (const key of allKeys) {
      expect(FEATURE_KEYS).toContain(key);
    }
  });

  it('rejects an unknown plan slug via the branded schema', () => {
    expect(() => planSlugSchema.parse('premium')).toThrow();
    expect(planSlugSchema.parse('essencial')).toBe('essencial');
    expect(planSlugSchema.parse('avancado')).toBe('avancado');
  });
});

describe('emptyPlansFallback', () => {
  it('returns the contact message and support email', () => {
    const fallback = emptyPlansFallback();
    expect(fallback.message).toBe('Entre em contato para saber mais');
    expect(fallback.supportEmail).toBe(PRICING_SUPPORT_EMAIL);
    expect(fallback.supportEmail).toBe('suporte@hubrity.com');
  });
});
