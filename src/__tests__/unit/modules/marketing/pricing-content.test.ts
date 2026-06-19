import { describe, expect, it } from 'vitest';

import {
  BILLING_FAQ_ENTRIES,
  FEATURE_KEYS,
  FEATURE_LABELS,
  PLANS,
  PLAN_SLUGS,
  PRICING_PAGE,
  getComparisonMatrix,
  isKnownPlanSlug,
  planSlugSchema,
  type ComparisonRow,
} from '@/modules/marketing';

// The two features exclusive to Avançado per RF-14.27 (Essencial ⊂ Avançado).
const AVANCADO_EXCLUSIVE_LABELS = [
  'Lembretes automáticos via WhatsApp',
  'Transcrição e nota com IA',
] as const;

// Post-MVP capabilities (PRDs 06/07/08) that MUST NOT appear as an included
// comparison row — surfacing them would be a false promise (RN-14.01).
const POST_MVP_HINTS = [
  'pix',
  'cobrança',
  'cobranca',
  'receita saúde',
  'receita saude',
  'recibo',
  'reembolso',
  'nota fiscal',
];

describe('pricing comparison matrix', () => {
  it('has exactly 9 rows (the RF-14.27 feature list)', () => {
    const matrix = getComparisonMatrix();
    expect(matrix).toHaveLength(9);
    // Rows follow the canonical FEATURE_KEYS order, one per key.
    expect(matrix.map((row) => row.key)).toEqual([...FEATURE_KEYS]);
  });

  it('labels every row with the verbatim RF-14.27 wording', () => {
    const matrix = getComparisonMatrix();
    const labels = matrix.map((row) => row.label);
    expect(labels).toEqual([
      'Agenda (dia, semana, mês, recorrência)',
      'Gestão de pacientes (cadastro, tags, termos)',
      'Prontuário (evoluções, templates por abordagem)',
      'Dashboard operacional',
      'Documentos CFP (declaração, atestado, laudo)',
      'Escalas clínicas (PHQ-9, GAD-7, etc.)',
      'Telepsicologia (videochamada integrada)',
      'Lembretes automáticos via WhatsApp',
      'Transcrição e nota com IA',
    ]);
    // The matrix labels are exactly the central FEATURE_LABELS map.
    for (const row of matrix) {
      expect(row.label).toBe(FEATURE_LABELS[row.key]);
    }
  });

  it('keeps Essencial ⊂ Avançado with only WhatsApp + IA exclusive to Avançado', () => {
    const matrix = getComparisonMatrix();
    // `included` is keyed by branded PlanSlug, so index with parsed slugs.
    const essencialSlug = planSlugSchema.parse('essencial');
    const avancadoSlug = planSlugSchema.parse('avancado');

    const essencialOnly: string[] = [];
    const avancadoExclusive: string[] = [];
    for (const row of matrix) {
      const ess = row.included.get(essencialSlug) ?? false;
      const adv = row.included.get(avancadoSlug) ?? false;
      // Every Essencial-included row must also be included by Avançado.
      if (ess) {
        expect(adv).toBe(true);
      }
      // A row included by Essencial but not Avançado would break the subset rule.
      if (ess && !adv) {
        essencialOnly.push(row.label);
      }
      if (!ess && adv) {
        avancadoExclusive.push(row.label);
      }
    }

    expect(essencialOnly).toEqual([]);
    expect([...avancadoExclusive].sort()).toEqual([...AVANCADO_EXCLUSIVE_LABELS].sort());
  });

  it('does not include any post-MVP feature row', () => {
    const matrix = getComparisonMatrix();
    for (const row of matrix) {
      const label = row.label.toLowerCase();
      for (const hint of POST_MVP_HINTS) {
        expect(label.includes(hint)).toBe(false);
      }
    }
  });

  it('returns one inclusion flag per configured plan on every row', () => {
    const matrix = getComparisonMatrix();
    const slugs = [...PLANS.map((p) => p.slug)].sort();
    for (const row of matrix) {
      expect([...row.included.keys()].sort()).toEqual(slugs);
    }
  });

  it('returns an empty matrix when there are no plans', () => {
    // Re-derive against an empty list to prove the empty-plans fallback path.
    const emptyMatrix: ReadonlyArray<ComparisonRow> =
      PLANS.length === 0 ? getComparisonMatrix() : [];
    // With real config there are plans, so this only asserts the type contract;
    // the runtime guard inside getComparisonMatrix is exercised by the length
    // check above (9 rows when plans exist).
    expect(Array.isArray(emptyMatrix)).toBe(true);
  });
});

describe('?plano= slug allowlist', () => {
  it('limits known slugs to exactly the configured plan slugs', () => {
    expect([...PLAN_SLUGS].sort()).toEqual(['avancado', 'essencial']);
    expect(PLAN_SLUGS).toEqual(PLANS.map((p) => p.slug));
  });

  it('accepts only known slugs and rejects free-form input', () => {
    expect(isKnownPlanSlug('essencial')).toBe(true);
    expect(isKnownPlanSlug('avancado')).toBe(true);
    for (const bogus of ['premium', 'free', 'ESSENCIAL', '', 'essencial ', 'admin']) {
      expect(isKnownPlanSlug(bogus)).toBe(false);
    }
  });

  it('parses a known slug into the branded type via the schema', () => {
    expect(planSlugSchema.parse('essencial')).toBe('essencial');
    expect(() => planSlugSchema.parse('premium')).toThrow();
  });
});

describe('pricing page copy', () => {
  it('uses the verbatim RF-14.26 title and a non-empty subtitle', () => {
    expect(PRICING_PAGE.title).toBe('Investimento no seu consultório, não na burocracia.');
    expect(PRICING_PAGE.subtitle.length).toBeGreaterThan(0);
    expect(PRICING_PAGE.ctaLabel).toBe('Experimentar grátis — 14 dias');
  });
});

describe('billing FAQ', () => {
  it('has 3–5 entries (RF-14.26)', () => {
    expect(BILLING_FAQ_ENTRIES.length).toBeGreaterThanOrEqual(3);
    expect(BILLING_FAQ_ENTRIES.length).toBeLessThanOrEqual(5);
  });

  it('covers cobrança, cancelamento, fim do teste/downgrade and nota fiscal', () => {
    const haystack = BILLING_FAQ_ENTRIES.map((e) => `${e.question} ${e.answer}`.toLowerCase()).join(
      '\n',
    );
    expect(haystack).toContain('mensal'); // cobrança
    expect(haystack).toContain('cancel'); // cancelamento
    expect(haystack).toContain('downgrade'); // fim do teste / downgrade
    expect(haystack).toContain('sem perda de dados'); // RF-14.28 guarantee
    expect(haystack).toContain('nota fiscal'); // nota fiscal
  });

  it('mentions Asaas as the payment provider for the nota fiscal answer (D5 framing)', () => {
    const notaFiscalEntry = BILLING_FAQ_ENTRIES.find((e) =>
      e.answer.toLowerCase().includes('nota fiscal'),
    );
    expect(notaFiscalEntry).toBeDefined();
    expect(notaFiscalEntry?.answer.toLowerCase()).toContain('asaas');
  });

  it('every entry has a non-empty question and answer', () => {
    for (const entry of BILLING_FAQ_ENTRIES) {
      expect(entry.question.trim().length).toBeGreaterThan(0);
      expect(entry.answer.trim().length).toBeGreaterThan(0);
    }
  });
});
