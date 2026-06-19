// Single source of truth for the public pricing surface (the `/precos` page and
// any pricing card embedded elsewhere on the marketing site).
//
// Design decision D7:
//   - Prices are stored as INTEGER CENTS (`6000`, `9000`) to avoid float
//     rounding artefacts; currency formatting is done at the display layer via
//     `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
//   - `PlanSlug` is a branded string so a plain string cannot be passed where a
//     validated slug is expected.
//   - The config is Zod-validated at module load: a malformed plan list throws
//     immediately at import time, never silently rendering a broken card.
//
// MVP guard: only features that exist in the MVP may appear here. Post-MVP
// features (PIX/billing, Receita Saúde, reimbursement receipts) MUST NOT be
// added to `PLAN_FEATURES` — surfacing an unavailable feature on the pricing
// page would be a false promise. The unit test asserts this invariant.
import { z } from 'zod';

/**
 * Branded plan identifier. Use `planSlugSchema.parse(...)` to obtain one from an
 * untrusted string; a bare string will not type-check where a `PlanSlug` is
 * required.
 */
export const planSlugSchema = z.enum(['essencial', 'avancado']).brand<'PlanSlug'>();
export type PlanSlug = z.infer<typeof planSlugSchema>;

/**
 * Stable identifiers for the MVP feature matrix. Each plan declares which of
 * these it includes. Adding a key here that is not actually shipped in the MVP
 * is a bug — see the MVP guard note at the top of this file.
 */
export const FEATURE_KEYS = [
  'agenda',
  'prontuario',
  'cadastro_pacientes',
  'prescricao_digital',
  'confirmacao_sessao',
  'lembretes_whatsapp',
  'transcricao_ia',
] as const;

export const featureKeySchema = z.enum(FEATURE_KEYS);
export type FeatureKey = z.infer<typeof featureKeySchema>;

/**
 * Human-readable label (pt-BR) for each MVP feature, shown on the pricing card.
 */
export const FEATURE_LABELS: Readonly<Record<FeatureKey, string>> = {
  agenda: 'Agenda',
  prontuario: 'Prontuário',
  cadastro_pacientes: 'Cadastro de pacientes',
  prescricao_digital: 'Prescrição digital',
  confirmacao_sessao: 'Confirmação de sessão',
  lembretes_whatsapp: 'Lembretes automáticos via WhatsApp',
  transcricao_ia: 'Transcrição e nota com IA',
};

const planFeatureSchema = z.object({
  key: featureKeySchema,
  /** Whether this plan includes the feature. */
  included: z.boolean(),
});
export type PlanFeature = z.infer<typeof planFeatureSchema>;

const planSchema = z.object({
  slug: planSlugSchema,
  name: z.string().min(1),
  /** Monthly price in integer cents (BRL). Billing is monthly only in the MVP. */
  priceCents: z.number().int().positive(),
  /** Marketing highlight tag, e.g. "Mais popular". Optional. */
  badge: z.string().min(1).optional(),
  /** Feature matrix entries; every feature key appears exactly once. */
  features: z
    .array(planFeatureSchema)
    .length(FEATURE_KEYS.length)
    .refine((features) => new Set(features.map((f) => f.key)).size === FEATURE_KEYS.length, {
      message: 'each feature key must appear exactly once',
    }),
});
export type Plan = z.infer<typeof planSchema>;

const plansSchema = z.array(planSchema);

// The two MVP plans. Avançado is a strict superset of Essencial: it differs
// ONLY by WhatsApp automation reminders and AI transcription/notes.
const RAW_PLANS = [
  {
    slug: 'essencial',
    name: 'Essencial',
    priceCents: 6000,
    features: [
      { key: 'agenda', included: true },
      { key: 'prontuario', included: true },
      { key: 'cadastro_pacientes', included: true },
      { key: 'prescricao_digital', included: true },
      { key: 'confirmacao_sessao', included: true },
      { key: 'lembretes_whatsapp', included: false },
      { key: 'transcricao_ia', included: false },
    ],
  },
  {
    slug: 'avancado',
    name: 'Avançado',
    priceCents: 9000,
    badge: 'Mais popular',
    features: [
      { key: 'agenda', included: true },
      { key: 'prontuario', included: true },
      { key: 'cadastro_pacientes', included: true },
      { key: 'prescricao_digital', included: true },
      { key: 'confirmacao_sessao', included: true },
      { key: 'lembretes_whatsapp', included: true },
      { key: 'transcricao_ia', included: true },
    ],
  },
] as const;

/**
 * The validated MVP plan list. Parsing happens at module load, so an invalid
 * config throws on import rather than rendering a broken pricing surface.
 */
export const PLANS: ReadonlyArray<Plan> = plansSchema.parse(RAW_PLANS);

/**
 * Support contact shown by the empty-plans fallback (and elsewhere on the
 * pricing surface). Kept here so pricing code has a single import.
 */
export const PRICING_SUPPORT_EMAIL = 'hubrity.platform@gmail.com';

/**
 * Fallback content for pricing surfaces when the plan list resolves to zero
 * entries. Rendering this instead of an empty grid guarantees the page never
 * shows a broken/empty card.
 */
export interface EmptyPlansFallback {
  message: string;
  supportEmail: string;
}

/**
 * Returns the empty-plans safety fallback: a "contact us" message plus the
 * support email. Pricing surfaces call this when `plans.length === 0` and
 * render the result instead of an empty plan grid.
 */
export function emptyPlansFallback(): EmptyPlansFallback {
  return {
    message: 'Entre em contato para saber mais',
    supportEmail: PRICING_SUPPORT_EMAIL,
  };
}
