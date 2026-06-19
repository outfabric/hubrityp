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

/** A call-to-action link used across hero / destaque-IA / CTA-final sections. */
export interface HomeCta {
  /** Visible button label (pt-BR). */
  readonly label: string;
  /** Destination. Internal app path (e.g. `/signup`) or in-page anchor (`#funcionalidades`). */
  readonly href: string;
}

/** A single market-data statistic shown in the prova-social bar. */
export interface SocialProofStat {
  readonly text: string;
}

/** A Lucide icon name. Kept as a string so this data module stays dependency-free;
 *  the rendering component maps the name to the actual icon component. */
export type LucideIconName = string;

/** One step in the solução value-cycle timeline. */
export interface SolutionStep {
  /** 1-based position used for the ordered timeline. */
  readonly order: number;
  /** Lucide icon name rendered inside the `brand/50` chip. */
  readonly icon: LucideIconName;
  /** Short step title. */
  readonly title: string;
  /** One-line explanation. */
  readonly description: string;
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

/** A regulatory guarantee in the confiança checklist. */
export interface RegulatoryGuarantee {
  readonly text: string;
}

/** A FAQ entry rendered as a native `<details>/<summary>` item. */
export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

// ---------------------------------------------------------------------------
// 1. Hero
// ---------------------------------------------------------------------------

export const HERO = {
  badge: 'Feito para psicólogos autônomos',
  headline: 'Muitas ferramentas viram um único sistema clínico.',
  subheadline:
    'Agenda, prontuário, videochamada, WhatsApp automatizado e uma IA que transcreve e escreve a evolução para você — em conformidade com o CFP e a LGPD.',
  primaryCta: { label: 'Começar grátis — 14 dias', href: '/signup' },
  secondaryCta: { label: 'Ver funcionalidades', href: '#funcionalidades' },
  microcopy: 'Sem cartão de crédito. Cancele quando quiser.',
} as const satisfies {
  badge: string;
  headline: string;
  subheadline: string;
  primaryCta: HomeCta;
  secondaryCta: HomeCta;
  microcopy: string;
};

// ---------------------------------------------------------------------------
// 2. Prova social (market stats — no fabricated testimonials)
// ---------------------------------------------------------------------------

export const SOCIAL_PROOF_STATS: ReadonlyArray<SocialProofStat> = [
  {
    text: 'Psicólogos gastam até 5 horas por semana com burocracia que o sistema resolve em minutos.',
  },
  { text: '40–60% das sessões hoje são online ou híbridas.' },
] as const;

// ---------------------------------------------------------------------------
// 3. Problema (mirror) — "Você ainda faz isso?"
// ---------------------------------------------------------------------------

export const PROBLEM = {
  title: 'Você ainda faz isso?',
  /** Exactly 5 short mirror items. */
  items: [
    'Manda lembrete de sessão no WhatsApp, um por um, na mão.',
    'Escreve a evolução no Word ou em um caderno.',
    'Controla a agenda no Google Agenda.',
    'Atende no Google Meet com link que expira.',
    'Guarda os pacientes em uma planilha de Excel.',
  ],
  closer: 'Não é falta de organização. É excesso de ferramentas que nunca foram feitas para você.',
} as const satisfies { title: string; items: readonly string[]; closer: string };

// ---------------------------------------------------------------------------
// 4. Solução timeline — 6 connected steps
// ---------------------------------------------------------------------------

export const SOLUTION_STEPS: ReadonlyArray<SolutionStep> = [
  {
    order: 1,
    icon: 'UserPlus',
    title: 'Paciente cadastrado',
    description: 'Cadastre o paciente uma vez e tenha tudo num só lugar.',
  },
  {
    order: 2,
    icon: 'CalendarPlus',
    title: 'Sessão agendada',
    description: 'Agende presencial, online ou híbrido em poucos cliques.',
  },
  {
    order: 3,
    icon: 'MessageCircle',
    title: 'Lembrete WhatsApp + confirmação 1-clique',
    description: 'O sistema lembra o paciente e ele confirma com um toque.',
  },
  {
    order: 4,
    icon: 'Video',
    title: 'Videochamada integrada',
    description: 'Atenda online sem links que expiram nem app extra.',
  },
  {
    order: 5,
    icon: 'Sparkles',
    title: 'Sessão finalizada → IA transcreve e gera evolução',
    description: 'A IA transcreve o áudio e redige a evolução para você revisar.',
  },
  {
    order: 6,
    icon: 'ShieldCheck',
    title: 'Prontuário salvo, CFP cumprido',
    description: 'O registro fica guardado com segurança e dentro das normas.',
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
  title: 'Construído para o jeito que psicólogos brasileiros precisam trabalhar.',
  /** Exactly 8 guarantees using the EXACT resolution numbers/years from the spec. */
  guarantees: [
    { text: 'Em conformidade com a Resolução CFP nº 001/2009.' },
    { text: 'Em conformidade com a Resolução CFP nº 06/2019.' },
    { text: 'Em conformidade com a Resolução CFP nº 09/2024.' },
    { text: 'Em conformidade com a Res. CFP nº 13/2022.' },
    { text: 'Dados em servidores no Brasil — São Paulo (LGPD).' },
    { text: 'Criptografia AES-256 em repouso, TLS 1.3 em trânsito.' },
    { text: 'Guarda de prontuário por 20 anos (Lei 13.787/2018).' },
    { text: 'Somente psicólogos com CRP ativo podem criar conta.' },
  ],
  closer: 'Você foca no paciente. A burocracia regulatória é problema nosso.',
} as const satisfies {
  title: string;
  guarantees: readonly RegulatoryGuarantee[];
  closer: string;
};

// ---------------------------------------------------------------------------
// 8. Preços resumo (strings only — prices come from `plans.ts` central config)
// ---------------------------------------------------------------------------

export const PRICING_SUMMARY = {
  title: 'Simples. Sem surpresa.',
  microcopy: '14 dias grátis para testar tudo. Sem cartão de crédito. Cancele quando quiser.',
  fullPlansLinkLabel: 'Ver planos completos →',
  fullPlansHref: '/precos',
} as const satisfies {
  title: string;
  microcopy: string;
  fullPlansLinkLabel: string;
  fullPlansHref: string;
};

// ---------------------------------------------------------------------------
// 9. FAQ — 5 required MVP entries
// ---------------------------------------------------------------------------

export const FAQ_ENTRIES: ReadonlyArray<FaqEntry> = [
  {
    question: 'Meus dados de paciente ficam seguros?',
    answer:
      'Sim. Seus dados ficam em servidores no Brasil (São Paulo), com criptografia AES-256, e seguem a LGPD. Você, psicóloga, é a controladora dos dados; nós somos apenas operadores que processam por sua conta.',
  },
  {
    question: 'Funciona para atendimento presencial também?',
    answer:
      'Sim. O sistema atende presencial, online e híbrido. Para a evolução com IA no presencial, basta fazer o upload do áudio da sessão.',
  },
  {
    question: 'Preciso cancelar o Google Agenda?',
    answer:
      'Não. Você importa seus pacientes por CSV e migra no seu próprio ritmo, sem precisar abandonar suas ferramentas de uma vez.',
  },
  {
    question: 'A IA vai errar e inventar conteúdo?',
    answer:
      'A IA gera uma sugestão sempre editável. Nada é salvo no prontuário sem a sua revisão — você tem a palavra final em cada evolução.',
  },
  {
    question: 'Quanto custa depois do período grátis?',
    answer:
      'O plano Essencial sai por R$ 60/mês e o Avançado por R$ 90/mês, cobrados mensalmente. Veja todos os detalhes em /precos.',
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
