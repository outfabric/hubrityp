import type { Metadata } from 'next';
import * as React from 'react';

import {
  buildPageMetadata,
  Confianca,
  CtaFinal,
  DestaqueIa,
  Faq,
  Funcionalidades,
  Hero,
  PrecosResumo,
  Problema,
  ProvaSocial,
  SolucaoTimeline,
} from '@/modules/marketing';

/**
 * Public homepage (`/`) — the marketing landing page.
 *
 * Server Component (presentational only — no client hooks, no PII, no secrets).
 * It composes the ten marketing sections in spec order:
 *
 *   1. Hero            6. Destaque IA
 *   2. Prova social    7. Confiança (CFP/LGPD)
 *   3. Problema        8. Preços (resumo)
 *   4. Solução         9. FAQ
 *   5. Funcionalidades 10. CTA final
 *
 * Heading hierarchy: the page exposes exactly one `<h1>` — it lives inside the
 * `Hero` section; every other section starts at `<h2>`. The `(public)` layout
 * already provides the `<main>` landmark, so this page MUST NOT add its own
 * `<main>` wrapper.
 *
 * LCP: the hero carousel's first slide is the Largest Contentful Paint
 * candidate; `ScreenshotCarousel` renders it with `priority`, so Next emits the
 * preload hint for the hero image automatically — no manual `<link rel=preload>`
 * is needed (and adding one for a `next/image` source would duplicate the hint).
 */
export const metadata: Metadata = buildPageMetadata({
  title: 'Sistema clínico para psicólogos autônomos',
  description:
    'Agenda, prontuário, videochamada, WhatsApp automatizado e uma IA que transcreve e escreve a evolução — em conformidade com o CFP e a LGPD. 14 dias grátis, sem cartão.',
  path: '/',
});

export default function HomePage(): React.JSX.Element {
  return (
    <>
      <Hero />
      <ProvaSocial />
      <Problema />
      <SolucaoTimeline />
      <Funcionalidades />
      <DestaqueIa />
      <Confianca />
      <PrecosResumo />
      <Faq />
      <CtaFinal />
    </>
  );
}
