// Single source of truth for the `/precos` page COPY — the title, subtitle, the
// CTA labels, and the billing FAQ. Plan data (names, prices, badge, the 9-row
// feature matrix) lives in `plans.ts`; this module holds only the surrounding
// prose so the page never hardcodes copy inline in JSX.
//
// Design decisions:
//   - D5: the "nota fiscal" FAQ answer is framed as dependent on the payment
//     provider (Asaas) and the billing feature, which is post-MVP — so it lives
//     here as forward-looking copy, never as an available plan feature. This
//     keeps the MVP-only rule (RN-14.01) intact.
//   - RF-14.28: trial ends with an automatic downgrade to Essencial WITHOUT data
//     loss; the FAQ must say so verbatim in spirit.
//   - RF-14.29: the nota fiscal line is the exact PRD wording.
//
// This module is pure data + types — no runtime side effects, no Node/Edge deps —
// so it is safe to import from server components and (where copy is needed) from
// client leaves. The billing FAQ reuses the homepage `FaqEntry` shape and the
// same `<details>`-based accordion pattern.

import type { FaqEntry } from '@/modules/marketing/lib/home-content';

/**
 * Pricing-page header copy. The title is the exact RF-14.26 wording; the subtitle
 * frames the value (no surprise charges, monthly, cancel anytime).
 */
export const PRICING_PAGE = {
  /** The single `<h1>` of the page (RF-14.26, verbatim). */
  title: 'Investimento no seu consultório, não na burocracia.',
  subtitle:
    'Dois planos, cobrança mensal e 14 dias grátis para testar tudo. Sem cartão de crédito, sem fidelidade — cancele quando quiser.',
  /** CTA label repeated on each plan card and the final CTA (RF-14.26, verbatim). */
  ctaLabel: 'Experimentar grátis — 14 dias',
  /** Heading above the expandable comparison table. */
  comparisonTitle: 'Compare os planos',
} as const satisfies {
  title: string;
  subtitle: string;
  ctaLabel: string;
  comparisonTitle: string;
};

/**
 * Billing FAQ — 4 entries covering the RF-14.26 required topics: cobrança
 * (monthly), cancelamento, fim do teste/downgrade, and nota fiscal. Reuses the
 * homepage `FaqEntry` shape and the same accessible `<details>` accordion.
 */
// The billing FAQ does not condense on mobile (the pricing frame keeps the full
// copy at every width), so each entry carries only the `desktop` variant of the
// shared [[FaqEntry]] `ResponsiveCopy` shape.
export const BILLING_FAQ_ENTRIES: ReadonlyArray<FaqEntry> = [
  {
    question: { desktop: 'Como funciona a cobrança?' },
    answer: {
      desktop:
        'A cobrança é exclusivamente mensal: R$ 60/mês no plano Essencial e R$ 90/mês no plano Avançado. Não há plano anual no momento e nenhum valor é cobrado durante os 14 dias de teste.',
    },
  },
  {
    question: { desktop: 'Posso cancelar quando quiser?' },
    answer: {
      desktop:
        'Sim. Não há fidelidade nem multa: você cancela quando quiser e mantém o acesso até o fim do período já pago. Seus dados continuam disponíveis para exportação conforme a LGPD.',
    },
  },
  {
    question: { desktop: 'O que acontece quando o período de teste termina?' },
    answer: {
      desktop:
        'Ao final dos 14 dias você escolhe um plano. Se não escolher o Avançado, a conta faz downgrade automático para o Essencial, sem perda de dados — você apenas deixa de usar os lembretes via WhatsApp e a transcrição com IA, que são exclusivos do Avançado.',
    },
  },
  {
    question: { desktop: 'Vou receber nota fiscal?' },
    answer: {
      desktop:
        'Todas as cobranças geram nota fiscal automaticamente. A emissão depende do nosso provedor de pagamento (Asaas) e fica disponível assim que a cobrança recorrente é ativada.',
    },
  },
] as const;
