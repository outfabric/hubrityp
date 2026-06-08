'use client';

import { Check, Link as LinkIcon, MessageCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { GenerateConsentResult } from '@/modules/patients';

// Import the consent-share helpers from the LEAF, not the module barrel: the
// barrel re-exports `server-only` server impls, so a runtime VALUE import from it
// would pull server-only code into this `'use client'` bundle and break the build.
import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

import { buildConsentUrl, buildConsentWhatsAppHref } from '../lib/consent-share';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientConsentRowActionsProps {
  /** Patient whose consent term is being shared. */
  patientId: string;
  /**
   * Server-resolved phone used to build the WhatsApp share link. `null` when no
   * usable phone exists for the row — the WhatsApp action is then disabled.
   */
  sharePhone: string | null;
  /**
   * Server Action that resolves (reusing the pending token, never duplicating)
   * a consent term for the patient and returns its token.
   */
  generateConsentAction: (patientId: string) => Promise<GenerateConsentResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Per-row consent share actions for the "missing consent" pendência listing
 * (RF-12.14). Renders a "Copiar link" and an "Enviar por WhatsApp" control.
 *
 * The token-gated `/termo/{token}` URL is built client-side from
 * `window.location.origin` and is NEVER logged (PRD §11) — it only reaches the
 * clipboard or the pre-filled WhatsApp message.
 */
export function PatientConsentRowActions({
  patientId,
  sharePhone,
  generateConsentAction,
}: PatientConsentRowActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  // Cache the resolved token so a second action reuses it instead of triggering
  // another generate call (the server already de-duplicates, but this avoids the
  // round-trip entirely).
  const [cachedToken, setCachedToken] = useState<string | null>(null);

  /**
   * Resolves a consent token — reuses the locally cached token or asks the
   * server action for one (which reuses the pending token, no duplicate). On
   * failure it surfaces a sanitized toast and returns `null`.
   */
  const resolveToken = async (): Promise<string | null> => {
    if (cachedToken) return cachedToken;
    const result = await generateConsentAction(patientId);
    if (result.ok) {
      setCachedToken(result.token);
      return result.token;
    }
    toast.error('Erro ao gerar o termo de consentimento');
    return null;
  };

  const handleCopyLink = () => {
    startTransition(async () => {
      const token = await resolveToken();
      if (!token) return;
      // Token-gated URL — built client-side, never logged.
      const url = buildConsentUrl(window.location.origin, token);
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado', { duration: 4000 });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSendWhatsApp = () => {
    if (!sharePhone) return;
    startTransition(async () => {
      const token = await resolveToken();
      if (!token) return;
      // Token-gated URL — built client-side, never logged.
      const url = buildConsentUrl(window.location.origin, token);
      window.open(buildConsentWhatsAppHref(sharePhone, url), '_blank', 'noopener,noreferrer');
    });
  };

  const whatsAppDisabled = !sharePhone;

  return (
    <div className="flex items-center justify-end gap-1" data-testid="patient-consent-row-actions">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopyLink}
        disabled={isPending}
        data-testid="patient-consent-copy-link"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <LinkIcon className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">Copiar link</span>
      </Button>

      {whatsAppDisabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span wrapper: a disabled button does not fire the events Radix
                  needs to open the tooltip, so the trigger wraps it. */}
              <span tabIndex={0} data-testid="patient-consent-whatsapp-tooltip-trigger">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  data-testid="patient-consent-whatsapp"
                  aria-label="Enviar por WhatsApp"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Enviar por WhatsApp</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Cadastre um telefone para enviar pelo WhatsApp</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSendWhatsApp}
          disabled={isPending}
          data-testid="patient-consent-whatsapp"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Enviar por WhatsApp</span>
        </Button>
      )}
    </div>
  );
}
