// Single source of truth for the public homepage copy (the `/` marketing page).
//
// Design decision D2:
//   - Every headline, list, the 7 feature cards, the 8 regulatory guarantees and
//     the 5 FAQ entries live here (typed) instead of as inline magic strings in
//     JSX. This keeps the PRD's exact regulatory wording reviewable in one place
//     and enables future A/B testing or i18n.
//   - Regulatory strings use the EXACT resolution numbers/years from the spec and
//     are asserted by `home-content.test.ts` against the literal codes.
//
// MVP guard: the homepage must present only features that exist in the MVP. Post-
// MVP capabilities (PIX/cobrança/billing, Receita Saúde, recibos de reembolso)
// MUST NOT appear as available anywhere in this content. The unit test asserts
// this invariant against an explicit denylist.
//
// This module is pure data + types — no runtime side effects, no Node/Edge deps —
// so it is safe to import from server components and (where copy is needed) from
// client leaves.

// `PlanSlug` keys the curated `PRICING_SUMMARY.cards` map so a card can never
// reference a slug that does not exist in the central `PLANS` config; the
// runtime `planSlugSchema` brands the bare object keys back into `PlanSlug`
// when building the card lookup `Map`. `plans.ts` does not import this module,
// so there is no import cycle.
import { planSlugSchema, type PlanSlug } from '@/modules/marketing/lib/plans';

//
// ---------------------------------------------------------------------------
// Token map (design decision D3 — audited 1:1 against `src/app/globals.css`)
// ---------------------------------------------------------------------------
// Every Figma `var(--ds-X)` referenced by the 17 homepage frames maps to an
// EXISTING DS token (no value was invented). This note is the audit record; the
// rendering components read these via Tailwind utilities.
//
//   Color (Figma → DS `--ds-*` → Tailwind utility):
//     brand-50  #f2f5f1 → --ds-brand-50  → bg/text/border-brand-50
//     brand-100 #e1e8de → --ds-brand-100 → -brand-100
//     brand-200 #c2d1bc → --ds-brand-200 → -brand-200
//     brand-400 #7e9e78 → --ds-brand-400 → -brand-400
//     brand-600 #587355 → --ds-brand-600 → -brand-600
//     brand-700 #475d45 → --ds-brand-700 → -brand-700
//     text-primary   #1c1917 → --ds-text-primary   → text-text-primary
//     text-secondary #57534e → --ds-text-secondary → text-text-secondary
//     text-tertiary  #78716c → --ds-text-tertiary  → text-text-tertiary
//     text-inverse   #fafaf9 → --ds-text-inverse   → text-text-inverse
//     background     #fafaf9 → --ds-background      → bg-background
//     surface        #ffffff → --ds-surface         → bg-surface
//     surface-muted  #f5f5f4 → --ds-surface-muted   → bg-surface-muted
//     surface-sunken #f0efec → --ds-surface-sunken  → bg-surface-sunken
//     border         #e7e5e4 → --ds-border          → border-border
//     border-subtle  #efedeb → --ds-border-subtle   → border-border-subtle
//     border-strong  #d6d3d1 → --ds-border-strong   → border-border-strong
//
//   Type (Figma → DS):
//     Display/xl 52/56 (-0.5) → text-display-xl (DS utility)
//     Display/lg 40/46 (-0.4) → text-display-lg (DS utility)
//     Display/md 32/40 (-0.2) → text-display-md (DS utility)
//     Lead       20/30        → text-lead       (DS utility)
//     Heading/h2 22/28, Heading/h3 18/24, Heading/h4 16/22, Body/lg 17/28,
//     Body/base 15/22, Body/sm 13/20, Label/caption 12/16 (ls 0),
//     Label/caption-upper 12/16 (ls 6) → no dedicated DS utility; composed at
//     the component layer from base Tailwind size/leading/tracking utilities
//     (e.g. h2 = text-[22px]/[28px], caption-upper adds tracking-[0.06em]).
//     All Inter, weight <= 600 (DS weight rule). No type token is FLAGGED — each
//     has an exact size/line-height/tracking from the spec legend.
//
//   Spacing (px → DS, base 4): 4→space-1, 8→space-2, 12→space-3, 16→space-4,
//     20→space-5, 24→space-6, 32→space-8, 40→space-10, 48→space-12, 64→space-16,
//     96→space-24 (all present in `--ds-space-*`).
//
//   Radius (Figma → DS): lg 10 → --ds-radius-lg (rounded-lg), xl 12 →
//     --ds-radius-xl (rounded-xl), 2xl 16 → --ds-radius-2xl (rounded-2xl),
//     full 9999 → --ds-radius-full (rounded-full).
//
//   FLAGGED (no matching DS token): none. Every audited frame token resolves to
//   an existing DS color/space/radius token or a spec-exact type composition.
//   If a later frame introduces a value with no DS match, STOP and flag it here
//   rather than hardcoding the raw value.

/**
 * Copy that Figma condenses on the mobile breakpoint. When `mobile` is present,
 * the rendering component shows `desktop` from the `md` breakpoint up
 * (`hidden md:block`) and `mobile` below it (`md:hidden`), marking the hidden
 * variant `aria-hidden` so assistive tech reads the string once. When `mobile`
 * is absent the single `desktop` string is rendered at every breakpoint.
 *
 * Design decision D2: only the fields Figma actually condenses carry an override;
 * every other field stays a plain `string`, so the content module remains pure
 * and fully typed with no speculative branching.
 */
export interface ResponsiveCopy {
  /** Default copy, shown from the `md` breakpoint up (and below it when no `mobile`). */
  readonly desktop: string;
  /** Condensed copy shown below the `md` breakpoint. Omit when it equals `desktop`. */
  readonly mobile?: string;
}

/** A call-to-action link used across hero / destaque-IA / CTA-final sections. */
export interface HomeCta {
  /** Visible button label (pt-BR). */
  readonly label: string;
  /** Destination. Internal app path (e.g. `/signup`) or in-page anchor (`#funcionalidades`). */
  readonly href: string;
}

/**
 * A single market-data statistic shown in the prova-social bar, modeled as a
 * large `figure` over a supporting `caption` (Figma `113:2` / `135:2`). These are
 * reviewed market data points — NOT fabricated testimonials or invented metrics.
 */
export interface SocialProofStat {
  /** Large headline figure rendered in `Display/md` (e.g. "até 5h/semana"). */
  readonly figure: string;
  /** Supporting caption rendered in `Body/base` below the figure. */
  readonly caption: string;
}

/** A Lucide icon name. Kept as a string so this data module stays dependency-free;
 *  the rendering component maps the name to the actual icon component. */
export type LucideIconName = string;

/**
 * One step in the solução value-cycle timeline. Both `title` and `description`
 * are [[ResponsiveCopy]]: Figma condenses each on the mobile breakpoint
 * (`135:42`) relative to desktop (`116:2`). The rendering component shows the
 * desktop "PASSO 0N" marker only from `md` up and inline-numbers the step
 * (`N.`) below it.
 */
export interface SolutionStep {
  /** 1-based position used for the ordered timeline and the inline mobile number. */
  readonly order: number;
  /** Lucide icon name rendered inside the `brand/50` chip. */
  readonly icon: LucideIconName;
  /** Step title, with a condensed mobile variant. */
  readonly title: ResponsiveCopy;
  /** One-line explanation, with a condensed mobile variant. */
  readonly description: ResponsiveCopy;
}

/** A funcionalidades feature card (MVP-only). */
export interface FeatureCard {
  /** Stable identifier (also used to look up the screenshot, when applicable). */
  readonly id: string;
  /** Lucide icon name. */
  readonly icon: LucideIconName;
  /** Card title (`Heading/h3`). */
  readonly title: string;
  /** Benefit-focused 2–3 line description. */
  readonly description: string;
  /** Screenshot key (into `SCREENSHOTS`) opened in the lightbox, when the card has one. */
  readonly screenshot?: ScreenshotKey;
  /** Whether the card spans two columns on desktop (Dashboard does). */
  readonly wide?: boolean;
}

/** A trust/safety item in the destaque-IA section. */
export interface TrustItem {
  readonly text: string;
}

/**
 * A regulatory guarantee in the confiança checklist. The `text` is
 * [[ResponsiveCopy]]: most guarantees render the same string at every width, but
 * Figma condenses the AES-256/TLS-1.3 (item 6) and CRP-ativo (item 8) lines on
 * the mobile breakpoint (`137:2`) relative to desktop (`123:2`). The rendering
 * component shows `desktop` from `md` up and the condensed `mobile` below it,
 * marking the hidden variant `aria-hidden` so assistive tech reads it once.
 */
export interface RegulatoryGuarantee {
  readonly text: ResponsiveCopy;
}

/**
 * One mirror item in the Problema section — an icon chip plus a one-line label.
 * The label is [[ResponsiveCopy]]: Figma condenses each line on mobile
 * (`135:9`), so the rendering component shows the `desktop` string from the `md`
 * breakpoint up and the condensed `mobile` string below it.
 */
export interface ProblemItem {
  /** Lucide icon name rendered inside the `surface-sunken` / `brand` chip. */
  readonly icon: LucideIconName;
  /** One-line label, with a condensed mobile variant. */
  readonly label: ResponsiveCopy;
}

/**
 * A FAQ entry rendered as a native `<details>/<summary>` item. Both `question`
 * and `answer` are [[ResponsiveCopy]]: the homepage FAQ condenses several
 * questions and the AES-256/TLS-1.3 answer on the mobile breakpoint (Figma
 * `138:2`) relative to desktop (`125:2`). Surfaces that do not condense (the
 * pricing-page billing FAQ) simply omit `mobile`, so the single `desktop` string
 * renders at every breakpoint. The rendering `FaqAccordion` shows `desktop` from
 * the `md` breakpoint up and the condensed `mobile` below it, marking the hidden
 * variant `aria-hidden` so assistive tech reads each string once.
 */
export interface FaqEntry {
  readonly question: ResponsiveCopy;
  readonly answer: ResponsiveCopy;
}

// ---------------------------------------------------------------------------
// 1. Hero
// ---------------------------------------------------------------------------

// Headline, subheadline and microcopy carry a `mobile` override ([[ResponsiveCopy]]):
// Figma frame `108:2` (desktop) and `133:14` (mobile) condense them. The Hero
// renders both variants and toggles with Tailwind (`hidden md:block` /
// `md:hidden`), marking the inactive one `aria-hidden` so assistive tech reads
// each string once. The badge and CTAs are identical across breakpoints, so they
// stay plain strings / `HomeCta`.
export const HERO = {
  badge: 'Feito para psicólogos autônomos',
  headline: {
    desktop: 'De 10 ferramentas espalhadas a um só sistema clínico.',
    mobile: 'De 10 ferramentas a um só sistema clínico.',
  },
  subheadline: {
    desktop:
      'Agenda, prontuário, videochamada, lembretes automáticos no WhatsApp e uma IA que transcreve a sessão e escreve a evolução — tudo em conformidade com o CFP e a LGPD.',
    mobile:
      'Agenda, prontuário, vídeo, WhatsApp automático e uma IA que escreve a evolução — em conformidade com o CFP e a LGPD.',
  },
  primaryCta: { label: 'Começar grátis — 14 dias', href: '/signup' },
  secondaryCta: { label: 'Ver funcionalidades', href: '#funcionalidades' },
  microcopy: {
    desktop: 'Sem cartão de crédito. Cancele quando quiser.',
    mobile: 'Sem cartão. Cancele quando quiser.',
  },
} as const satisfies {
  badge: string;
  headline: ResponsiveCopy;
  subheadline: ResponsiveCopy;
  primaryCta: HomeCta;
  secondaryCta: HomeCta;
  microcopy: ResponsiveCopy;
};

// ---------------------------------------------------------------------------
// 2. Prova social (market stats — no fabricated testimonials)
// ---------------------------------------------------------------------------

export const SOCIAL_PROOF_STATS: ReadonlyArray<SocialProofStat> = [
  {
    figure: 'até 5h/semana',
    caption: 'gastas com burocracia que o sistema resolve em minutos',
  },
  {
    figure: '40–60%',
    caption: 'das sessões hoje já são online ou híbridas no Brasil',
  },
] as const;

// ---------------------------------------------------------------------------
// 3. Problema (mirror) — "Você ainda faz isso?"
// ---------------------------------------------------------------------------

export const PROBLEM = {
  title: 'Você ainda faz isso?',
  /**
   * Exactly 5 mirror items (Figma desktop `114:2` / mobile `135:9`). Each is an
   * icon chip + a one-line label; the label condenses on mobile.
   */
  items: [
    {
      icon: 'MessageCircle',
      label: {
        desktop: 'Manda lembrete de sessão pelo WhatsApp na mão, uma a uma',
        mobile: 'Lembrete pelo WhatsApp, na mão',
      },
    },
    {
      icon: 'FileText',
      label: {
        desktop: 'Registra a evolução no Word — ou no caderno',
        mobile: 'Evolução no Word ou no caderno',
      },
    },
    {
      icon: 'Calendar',
      label: {
        desktop: 'Gerencia a agenda no Google Agenda',
        mobile: 'Agenda no Google Agenda',
      },
    },
    {
      icon: 'Video',
      label: {
        desktop: 'Abre o Google Meet com um link que sempre expira',
        mobile: 'Google Meet com link que expira',
      },
    },
    {
      icon: 'Table',
      label: {
        desktop: 'Controla os pacientes numa planilha de Excel',
        mobile: 'Pacientes numa planilha de Excel',
      },
    },
  ],
  closer: 'Não é falta de organização. É excesso de ferramentas que nunca foram feitas para você.',
} as const satisfies { title: string; items: readonly ProblemItem[]; closer: string };

// ---------------------------------------------------------------------------
// 4. Solução timeline — 6 connected steps
// ---------------------------------------------------------------------------

// Section title + subtitle carry a `mobile` override ([[ResponsiveCopy]]): the
// desktop heading (Figma `116:2`, `Display/lg`) is condensed on mobile (`135:42`)
// and the `Lead` subtitle is desktop-only (Figma drops it on mobile, so it stays
// `hidden md:block` at the component layer).
export const SOLUTION_TITLE = {
  desktop: 'Tudo que o consultório precisa, num só lugar que conversa consigo mesmo.',
  mobile: 'Tudo num só lugar que conversa consigo mesmo.',
} as const satisfies ResponsiveCopy;

export const SOLUTION_SUBTITLE =
  'Cada módulo entrega para o próximo. Você faz uma vez; o sistema cuida do resto.';

export const SOLUTION_STEPS: ReadonlyArray<SolutionStep> = [
  {
    order: 1,
    icon: 'UserPlus',
    title: { desktop: 'Paciente cadastrado' },
    description: {
      desktop: 'Cadastro completo, com termo de consentimento digital.',
      mobile: 'com termo de consentimento digital.',
    },
  },
  {
    order: 2,
    icon: 'CalendarPlus',
    title: { desktop: 'Sessão agendada' },
    description: {
      desktop: 'Marque na agenda — recorrência em 1 clique.',
      mobile: 'recorrência em 1 clique.',
    },
  },
  {
    order: 3,
    icon: 'MessageCircle',
    title: { desktop: 'Lembrete no WhatsApp' },
    description: {
      desktop: 'Enviado sozinho. O paciente confirma com um toque.',
      mobile: 'o paciente confirma num toque.',
    },
  },
  {
    order: 4,
    icon: 'Video',
    title: { desktop: 'Videochamada integrada' },
    description: {
      desktop: 'Sala criada na hora. Ninguém instala nada.',
      mobile: 'ninguém instala nada.',
    },
  },
  {
    order: 5,
    icon: 'Sparkles',
    title: {
      desktop: 'IA transcreve e escreve',
      mobile: 'IA escreve a evolução',
    },
    description: {
      desktop: 'A sessão termina e a evolução chega pronta.',
      mobile: 'você só revisa.',
    },
  },
  {
    order: 6,
    icon: 'ShieldCheck',
    title: { desktop: 'Prontuário salvo' },
    description: {
      desktop: 'Você revisa, salva e o CFP está cumprido.',
      mobile: 'CFP cumprido.',
    },
  },
] as const;

export const SOLUTION_CLOSER = 'De ponta a ponta — sem sair do sistema.';

// ---------------------------------------------------------------------------
// 5. Funcionalidades — 7 MVP feature cards
// ---------------------------------------------------------------------------

export const FEATURE_CARDS: ReadonlyArray<FeatureCard> = [
  {
    id: 'agenda',
    icon: 'Calendar',
    title: 'Agenda',
    description:
      'Sua semana inteira em uma tela: presencial, online e híbrido, com o status de confirmação de cada sessão.',
    screenshot: 'agenda',
  },
  {
    id: 'pacientes',
    icon: 'Users',
    title: 'Pacientes',
    description:
      'Cadastro completo com filtros e tags. Encontre qualquer paciente em segundos, sem planilha.',
    screenshot: 'pacientes',
  },
  {
    id: 'whatsapp',
    icon: 'MessageCircle',
    title: 'WhatsApp Automático',
    description:
      'Lembretes e confirmações enviados automaticamente. Menos faltas, zero mensagem digitada na mão.',
    screenshot: 'whatsapp',
  },
  {
    id: 'prontuario',
    icon: 'FileText',
    title: 'Prontuário',
    description:
      'Evoluções, registros e histórico clínico organizados e seguros, no padrão que o CFP exige.',
    screenshot: 'prontuario',
  },
  {
    id: 'telepsicologia',
    icon: 'Video',
    title: 'Telepsicologia',
    description:
      'Sala de videochamada integrada ao prontuário. Sem link que expira, sem trocar de aplicativo.',
    screenshot: 'telepsicologia',
  },
  {
    id: 'ia-clinica',
    icon: 'Sparkles',
    title: 'IA Clínica',
    description:
      'A IA transcreve a sessão e escreve a evolução. Você só revisa e salva — em um minuto.',
    screenshot: 'evolucao',
  },
  {
    id: 'dashboard',
    icon: 'LayoutDashboard',
    title: 'Dashboard Operacional',
    description:
      'O "Hoje" e as "Pendências" da sua semana em um só painel. Saiba o que fazer assim que abre o sistema.',
    screenshot: 'hoje-pendencias',
    wide: true,
  },
] as const;

// ---------------------------------------------------------------------------
// 6. Destaque IA
// ---------------------------------------------------------------------------

export const AI_HIGHLIGHT = {
  title: '10 minutos de registro → 1 minuto. Em 30 sessões por semana, você recupera até 5 horas.',
  subtitle:
    'Grave a sessão, e a IA transcreve e redige a evolução. Você revisa, ajusta e salva — sem começar do zero a cada atendimento.',
  /** "Antes" / "Depois" comparison labels. */
  beforeLabel: '15 min escrevendo após cada sessão',
  afterLabel: '1 min revisando e salvando',
  /** Exactly 4 trust/safety items. */
  trustItems: [
    'Consentimento obrigatório do paciente antes de qualquer gravação.',
    'Áudio descartado em até 24 horas.',
    'Processamento via API, sem armazenamento pelo provedor.',
    'Revisão humana obrigatória antes de salvar.',
  ],
  cta: { label: 'Comece grátis e experimente na primeira sessão', href: '/signup' },
} as const satisfies {
  title: string;
  subtitle: string;
  beforeLabel: string;
  afterLabel: string;
  trustItems: readonly string[];
  cta: HomeCta;
};

// ---------------------------------------------------------------------------
// 7. Confiança — 8 regulatory guarantees (EXACT codes)
// ---------------------------------------------------------------------------

export const TRUST = {
  /** Uppercase eyebrow (Figma `123:2`/`137:2`, `Label/caption-upper`, `brand-700`). */
  eyebrow: 'CONFORMIDADE & SEGURANÇA',
  title: 'Construído para o jeito que psicólogos brasileiros precisam trabalhar.',
  /**
   * Exactly 8 guarantees using the EXACT resolution numbers/years from the spec.
   * Items 6 (AES-256/TLS 1.3) and 8 (CRP ativo) carry a condensed `mobile`
   * variant that Figma uses below the `md` breakpoint; the literal regulatory
   * codes/standards are preserved in both variants.
   */
  guarantees: [
    { text: { desktop: 'Prontuário conforme a Resolução CFP nº 001/2009' } },
    { text: { desktop: 'Documentos no padrão da Resolução CFP nº 06/2019' } },
    { text: { desktop: 'Telepsicologia conforme a Resolução CFP nº 09/2024' } },
    { text: { desktop: 'Gravação somente com consentimento (Res. CFP nº 13/2022)' } },
    { text: { desktop: 'Dados em servidores no Brasil — São Paulo (LGPD)' } },
    {
      text: {
        desktop: 'Criptografia AES-256 em repouso e TLS 1.3 em trânsito',
        mobile: 'Criptografia AES-256 e TLS 1.3',
      },
    },
    { text: { desktop: 'Guarda de prontuário por 20 anos (Lei 13.787/2018)' } },
    {
      text: {
        desktop: 'Somente psicólogos com CRP ativo podem criar conta',
        mobile: 'Somente psicólogos com CRP ativo criam conta',
      },
    },
  ],
  closer: 'Você foca no paciente. A burocracia regulatória é problema nosso.',
} as const satisfies {
  eyebrow: string;
  title: string;
  guarantees: readonly RegulatoryGuarantee[];
  closer: string;
};

// ---------------------------------------------------------------------------
// 8. Preços resumo (strings only — prices come from `plans.ts` central config)
// ---------------------------------------------------------------------------

/**
 * Per-card curated marketing copy for the homepage Preços teaser (design
 * decision D4). The price, plan name and the "Mais popular" badge stay sourced
 * from the central `PLANS` config in `plans.ts` — this map only carries the
 * curated tagline + summary bullets, which are marketing summaries (not the
 * verbatim RF-14.27 feature labels). Keyed by `PlanSlug` so the rendering
 * component looks each card up by `plan.slug` and the two sources can never
 * drift apart.
 *
 * Taglines and the longer bullets carry an optional `mobile` override
 * ([[ResponsiveCopy]]); on the mobile breakpoint Figma condenses them.
 */
export interface PricingSummaryCard {
  readonly tagline: ResponsiveCopy;
  readonly bullets: readonly ResponsiveCopy[];
}

export const PRICING_SUMMARY = {
  /** Uppercase eyebrow rendered above the title (Label/caption-upper, brand-700). */
  eyebrow: 'PLANOS',
  title: 'Simples. Sem surpresa.',
  /** Primary CTA label rendered on every plan card. Points at `/signup`. */
  ctaLabel: 'Começar grátis',
  microcopy: {
    desktop: '14 dias grátis para testar tudo. Sem cartão de crédito. Cancele quando quiser.',
    mobile: '14 dias grátis. Sem cartão. Cancele quando quiser.',
  },
  fullPlansLinkLabel: 'Ver planos completos →',
  fullPlansHref: '/precos',
  /**
   * Curated summary per plan slug. `bullets` are short marketing summaries (the
   * 1-clique feature highlights), NOT the verbatim RF-14.27 comparison labels.
   */
  cards: {
    essencial: {
      tagline: {
        desktop: 'Para começar com o essencial do consultório.',
        mobile: 'O núcleo clínico do consultório.',
      },
      bullets: [
        { desktop: 'Agenda, pacientes e prontuário' },
        { desktop: 'Telepsicologia integrada' },
        {
          desktop: 'Documentos CFP e escalas clínicas',
          mobile: 'Documentos CFP e escalas',
        },
        { desktop: 'Dashboard operacional' },
      ],
    },
    avancado: {
      tagline: { desktop: 'Tudo do Essencial + automação e IA.' },
      bullets: [
        { desktop: 'Tudo do Essencial' },
        {
          desktop: 'Lembretes automáticos no WhatsApp',
          mobile: 'Lembretes no WhatsApp',
        },
        { desktop: 'Transcrição e nota com IA' },
      ],
    },
  },
} as const satisfies {
  eyebrow: string;
  title: string;
  ctaLabel: string;
  microcopy: ResponsiveCopy;
  fullPlansLinkLabel: string;
  fullPlansHref: string;
  cards: Record<PlanSlug, PricingSummaryCard>;
};

/**
 * `PRICING_SUMMARY.cards` indexed by the branded `PlanSlug`. A `Map` is used
 * (rather than object indexing) because a plain object index signature does not
 * play well with branded string keys — the same reason `plans.ts` keys its
 * comparison matrix by a `Map<PlanSlug, …>`.
 */
const PRICING_SUMMARY_CARDS: ReadonlyMap<PlanSlug, PricingSummaryCard> = new Map(
  Object.entries(PRICING_SUMMARY.cards).map(([slug, card]) => [planSlugSchema.parse(slug), card]),
);

/**
 * Returns the curated `PRICING_SUMMARY` card for a plan slug. The lookup is
 * total — every configured plan has a curated card, asserted by the unit test
 * (`Object.keys(cards) === PLAN_SLUGS`) — so the entry is always present.
 */
export function pricingSummaryCardFor(slug: PlanSlug): PricingSummaryCard {
  const card = PRICING_SUMMARY_CARDS.get(slug);
  if (card === undefined) {
    // Unreachable given the content/config invariant; throw rather than render a
    // broken card if the two ever drift.
    throw new Error(`No pricing-summary card configured for plan slug "${slug}"`);
  }
  return card;
}

// ---------------------------------------------------------------------------
// 9. FAQ — 5 required MVP entries
// ---------------------------------------------------------------------------

/**
 * Uppercase eyebrow above the FAQ title — DESKTOP ONLY (Figma `125:2`,
 * `Label/caption-upper` 12/16 ls 6, `brand-700`). The mobile frame (`138:2`)
 * shows the title with NO eyebrow, so the rendering `Faq` passes this only as the
 * desktop-gated `hidden md:block` eyebrow.
 */
export const FAQ_EYEBROW = 'PERGUNTAS FREQUENTES';

/** FAQ section title (Figma `125:2`/`138:2`, `Display/md` 32/40). */
export const FAQ_TITLE = 'Ainda em dúvida? Comece por aqui.';

// The 5 required MVP questions. Several condense on the mobile breakpoint
// ([[ResponsiveCopy]]): Figma `138:2` shortens questions 2/4/5 and replaces the
// long AES-256/TLS-1.3 answer of Q1 with a condensed line. Questions 1 and 3 and
// every other answer are identical across breakpoints, so they omit `mobile`.
export const FAQ_ENTRIES: ReadonlyArray<FaqEntry> = [
  {
    question: { desktop: 'Meus dados de paciente ficam seguros?' },
    answer: {
      desktop:
        'Sim. Os dados ficam em servidores no Brasil (São Paulo), com criptografia AES-256 em repouso e TLS 1.3 em trânsito. Você é a controladora dos dados; nós atuamos apenas como operadores, conforme a LGPD.',
      mobile:
        'Servidores no Brasil (São Paulo), AES-256 e TLS 1.3. Você é a controladora; nós, operadores, conforme a LGPD.',
    },
  },
  {
    question: {
      desktop: 'Funciona para atendimento presencial também?',
      mobile: 'Funciona para presencial também?',
    },
    answer: {
      desktop:
        'Sim. O sistema atende presencial, online e híbrido. Para a evolução com IA no presencial, basta fazer o upload do áudio da sessão.',
    },
  },
  {
    question: { desktop: 'Preciso cancelar o Google Agenda?' },
    answer: {
      desktop:
        'Não. Você importa seus pacientes por CSV e migra no seu próprio ritmo, sem precisar abandonar suas ferramentas de uma vez.',
    },
  },
  {
    question: {
      desktop: 'A IA vai errar e inventar conteúdo?',
      mobile: 'A IA inventa conteúdo?',
    },
    answer: {
      desktop:
        'A IA gera uma sugestão sempre editável. Nada é salvo no prontuário sem a sua revisão — você tem a palavra final em cada evolução.',
    },
  },
  {
    question: {
      desktop: 'Quanto custa depois do período grátis?',
      mobile: 'Quanto custa depois do teste?',
    },
    answer: {
      desktop:
        'O plano Essencial sai por R$ 60/mês e o Avançado por R$ 90/mês, cobrados mensalmente. Veja todos os detalhes em /precos.',
    },
  },
] as const;

// ---------------------------------------------------------------------------
// 10. CTA final
// ---------------------------------------------------------------------------

export const FINAL_CTA = {
  title: 'Comece hoje. Sem compromisso.',
  cta: { label: 'Criar conta grátis — 14 dias', href: '/signup' },
  microcopy: 'Configuração em 5 minutos. Sua primeira sessão registrada com IA ainda hoje.',
} as const satisfies { title: string; cta: HomeCta; microcopy: string };

// ---------------------------------------------------------------------------
// Screenshots — files in `public/screenshots/*.webp` with explicit dims + alt
// ---------------------------------------------------------------------------

/** Keys correspond 1:1 with `public/screenshots/<key>.webp`. */
export type ScreenshotKey =
  | 'hoje-pendencias'
  | 'painel'
  | 'agenda'
  | 'pacientes'
  | 'whatsapp'
  | 'prontuario'
  | 'telepsicologia'
  | 'evolucao';

export interface ScreenshotAsset {
  /** Public URL path served by Next from `public/`. */
  readonly src: string;
  /** Intrinsic width in px (for `next/image`, to keep CLS < 0.1). */
  readonly width: number;
  /** Intrinsic height in px. */
  readonly height: number;
  /** Descriptive pt-BR alt text. */
  readonly alt: string;
}

/**
 * Real-system screenshots used across the homepage (hero carousel, feature-card
 * thumbnails, destaque-IA). Dimensions match the optimized WebP files on disk so
 * `next/image` can reserve the correct box and avoid layout shift. All depict
 * fictitious-but-plausible data — no real patient data.
 */
export const SCREENSHOTS: Readonly<Record<ScreenshotKey, ScreenshotAsset>> = {
  'hoje-pendencias': {
    src: '/screenshots/hoje-pendencias.webp',
    width: 1060,
    height: 653,
    alt: 'Painel inicial do Hubrity mostrando as seções "Hoje" e "Pendências" da semana.',
  },
  painel: {
    src: '/screenshots/painel.webp',
    width: 1306,
    height: 653,
    alt: 'Painel operacional do Hubrity com a visão geral do dia do psicólogo.',
  },
  agenda: {
    src: '/screenshots/agenda.webp',
    width: 1043,
    height: 651,
    alt: 'Agenda semanal do Hubrity com sessões e seus status de confirmação.',
  },
  pacientes: {
    src: '/screenshots/pacientes.webp',
    width: 1084,
    height: 571,
    alt: 'Lista de pacientes do Hubrity com filtros e tags de organização.',
  },
  whatsapp: {
    src: '/screenshots/whatsapp.webp',
    width: 1562,
    height: 847,
    alt: 'Lembrete de sessão enviado automaticamente pelo WhatsApp com confirmação em um clique.',
  },
  prontuario: {
    src: '/screenshots/prontuario.webp',
    width: 1069,
    height: 527,
    alt: 'Prontuário eletrônico do Hubrity com o histórico clínico do paciente.',
  },
  telepsicologia: {
    src: '/screenshots/telepsicologia.webp',
    width: 1509,
    height: 940,
    alt: 'Sala de videochamada integrada do Hubrity para atendimento de telepsicologia.',
  },
  evolucao: {
    src: '/screenshots/evolucao.webp',
    width: 887,
    height: 651,
    alt: 'Evolução clínica redigida pela IA no prontuário, pronta para revisão.',
  },
} as const;

/**
 * The hero carousel screenshot set, in the spec order:
 * 1) Dashboard operacional, 2) Agenda semanal, 3) Evolução IA, 4) Pacientes,
 * 5) Sala de videochamada — each with a one-line caption.
 */
export const HERO_CAROUSEL_SLIDES: ReadonlyArray<{
  readonly screenshot: ScreenshotKey;
  readonly caption: string;
}> = [
  { screenshot: 'hoje-pendencias', caption: 'Seu dia em um painel: "Hoje" e "Pendências".' },
  { screenshot: 'agenda', caption: 'Agenda semanal com o status de confirmação de cada sessão.' },
  { screenshot: 'evolucao', caption: 'Evolução escrita pela IA, pronta para você revisar.' },
  { screenshot: 'pacientes', caption: 'Lista de pacientes com filtros e tags.' },
  { screenshot: 'telepsicologia', caption: 'Sala de videochamada integrada ao prontuário.' },
] as const;
