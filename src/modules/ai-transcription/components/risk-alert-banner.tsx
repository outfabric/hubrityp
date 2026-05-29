'use client';

import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { RiskAlert } from '@/modules/ai-transcription';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';

/**
 * pt-BR labels for each closed `RiskAlert['kind']`.
 *
 * Keyed by the canonical schema enum (`@/modules/ai-transcription`), so adding
 * a new kind to the schema without a label here is a compile error.
 */
const RISK_KIND_LABELS: Record<RiskAlert['kind'], string> = {
  suicidal: 'Ideação suicida',
  self_harm: 'Autolesão',
  domestic_violence: 'Violência doméstica',
  third_party_risk: 'Risco a terceiros',
  substance_abuse: 'Abuso de substâncias',
};

/**
 * Excerpts longer than this are truncated in the collapsed view; the full text
 * is revealed on click (per the Sálvia rule that tooltips must not carry
 * critical information — D5). The psychologist always reaches the full text.
 */
const EXCERPT_PREVIEW_LIMIT = 200;

interface RiskAlertItemProps {
  alert: RiskAlert;
}

/**
 * A single risk row: pt-BR kind label + the verbatim excerpt. We do NOT obscure
 * the text — the psychologist needs to read it (D5). When the excerpt exceeds
 * {@link EXCERPT_PREVIEW_LIMIT}, the preview is truncated with an ellipsis and a
 * click-to-expand control reveals the rest inline (a small expandable, not a
 * tooltip).
 */
function RiskAlertItem({ alert }: RiskAlertItemProps) {
  const excerpt = alert.excerpt.trim();
  const isLong = excerpt.length > EXCERPT_PREVIEW_LIMIT;
  const preview = isLong ? `${excerpt.slice(0, EXCERPT_PREVIEW_LIMIT)}…` : excerpt;

  return (
    <li className="space-y-1" data-testid="risk-alert-item" data-kind={alert.kind}>
      <span className="font-medium">{RISK_KIND_LABELS[alert.kind]}</span>
      {isLong ? (
        <Collapsible className="group/risk">
          <p className="group-data-[state=open]/risk:hidden">
            <span data-testid="risk-alert-excerpt">{preview}</span>{' '}
            <CollapsibleTrigger className="duration-fast hover:text-danger-500 focus-visible:shadow-focus underline underline-offset-2 transition-colors focus-visible:outline-none">
              Ver trecho completo
            </CollapsibleTrigger>
          </p>
          <CollapsibleContent>
            <p>
              <span data-testid="risk-alert-excerpt-full">{excerpt}</span>{' '}
              <CollapsibleTrigger className="duration-fast hover:text-danger-500 focus-visible:shadow-focus inline-flex items-center gap-1 underline underline-offset-2 transition-colors focus-visible:outline-none">
                Recolher
                <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
              </CollapsibleTrigger>
            </p>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <p data-testid="risk-alert-excerpt">{excerpt}</p>
      )}
    </li>
  );
}

export interface RiskAlertBannerProps {
  riskAlerts: RiskAlert[];
  className?: string;
}

/**
 * Danger banner rendered IFF the transcription carries at least one risk alert
 * (RF-10.18 / D5). It announces detected risk content, lists each alert with
 * its pt-BR kind label and verbatim excerpt, and prompts the psychologist to
 * consider next steps.
 *
 * Accessibility: the banner uses `role="alert"` (inherited from `Alert`) and
 * grabs focus on mount so a keyboard/AT user is taken straight to it. The
 * container is focusable via `tabIndex={-1}` (programmatic focus only, not in
 * the Tab order). Motion is limited to color/opacity transitions which the
 * global `prefers-reduced-motion` rule already neutralizes.
 */
export function RiskAlertBanner({ riskAlerts, className }: RiskAlertBannerProps) {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bannerRef.current?.focus();
  }, []);

  if (riskAlerts.length === 0) {
    return null;
  }

  return (
    <Alert
      ref={bannerRef}
      variant="danger"
      tabIndex={-1}
      data-testid="risk-alert-banner"
      className={cn('focus-visible:shadow-focus focus-visible:outline-none', className)}
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Conteúdo de risco identificado</AlertTitle>
      <AlertDescription className="space-y-3">
        <ul className="space-y-3">
          {riskAlerts.map((alert, index) => (
            <RiskAlertItem key={`${alert.kind}-${index}`} alert={alert} />
          ))}
        </ul>
        <p className="text-text-secondary">
          Considere: contato pós-sessão, plano de segurança, encaminhamento.
        </p>
      </AlertDescription>
    </Alert>
  );
}
