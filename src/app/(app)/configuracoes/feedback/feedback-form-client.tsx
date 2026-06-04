'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

// `NpsForm` is a runtime VALUE — import it from the component leaf, NOT the
// module barrel. The barrel re-exports server-only impls (which pull
// `db`/`postgres`); importing a value through it would drag the server graph
// into the client bundle and break `next build`. `SubmitNpsResult` is a
// type-only import (erased), so its path is harmless either way.
import { NpsForm } from '@/modules/nps/components/nps-form';
import type { SubmitNpsResult } from '@/modules/nps/server/submit-nps';
import { Card, CardContent } from '@/shared/ui/card';

interface FeedbackFormClientProps {
  /** Server Action wrapper that persists the NPS answer. */
  onSubmit: (input: { score: number; feedback?: string }) => Promise<SubmitNpsResult>;
  /**
   * True when the user already responded (or dismissed) the survey. The form is
   * shown at most once authoritatively (server-side `nps_responded_at` guard),
   * so we render the thank-you state directly instead of a form that would
   * no-op on submit.
   */
  alreadyResponded: boolean;
}

/**
 * Client leaf for the Configurações > Feedback entry — reuses the shared
 * {@link NpsForm} (no "Não responder agora": there is nothing to defer here).
 * After a successful submit, or when the user already responded, it shows a
 * thank-you confirmation. The form holds no server-authoritative state.
 */
export function FeedbackFormClient({ onSubmit, alreadyResponded }: FeedbackFormClientProps) {
  const [submitted, setSubmitted] = useState(false);

  if (alreadyResponded || submitted) {
    return (
      <Card data-testid="nps-feedback-thanks">
        <CardContent className="flex items-start gap-3 p-4 md:p-6">
          <CheckCircle2 className="text-success-500 mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-text-primary text-[15px] font-semibold">Obrigado pela sua opinião</p>
            <p className="text-text-secondary text-[13px]">
              Sua avaliação já foi registrada e ajuda a melhorar o sistema.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="nps-feedback-card">
      <CardContent className="p-4 md:p-6">
        <NpsForm onSubmit={onSubmit} onSubmitted={() => setSubmitted(true)} />
      </CardContent>
    </Card>
  );
}
