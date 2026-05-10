import { AlertCircle, Clock, Info, XCircle } from 'lucide-react';

import { formatSessionDateFull, formatSessionTime, getSessionByTokenImpl } from '@/modules/agenda';
import { PublicConfirmationForm } from '@/modules/agenda/components/public-confirmation-form';
import { Card, CardContent } from '@/shared/ui/card';

import { publicConfirmSessionAction, publicDeclineSessionAction } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfirmPageProps {
  params: Promise<{ token: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Public session confirmation page.
 *
 * This page is outside the `(app)` route group — no authentication required.
 * The confirmation token in the URL is the authorization credential (256 bits
 * of entropy). The middleware classifies `/confirmar-sessao` as `public` and
 * passes through.
 *
 * Design system alignment:
 *   - bg `background` (from layout)
 *   - Max-width 480px centered (from layout)
 *   - Session info inside `Card default` (radius `xl`, padding `space-8`
 *     desktop / `space-6` mobile)
 *   - Heading h2 (22px/600)
 *   - Semantic icons per state (CheckCircle2/Clock/Info/XCircle/AlertCircle)
 *   - Accessibility: aria-live polite on result region, WCAG AA contrast,
 *     keyboard navigation, 44x44px touch targets, prefers-reduced-motion
 */
export default async function ConfirmPage({ params }: ConfirmPageProps) {
  const { token } = await params;
  const result = await getSessionByTokenImpl(token);

  // Invalid token
  if (result.state === 'invalid') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        role="status"
        aria-live="polite"
        data-testid="confirmation-invalid"
      >
        <AlertCircle className="text-danger-500 h-12 w-12" aria-hidden="true" />
        <h2 className="text-text-primary text-[22px] leading-tight font-semibold">Link invalido</h2>
        <p className="text-text-secondary text-[15px]">Este link de confirmacao nao e valido.</p>
      </div>
    );
  }

  // Token expired
  if (result.state === 'expired') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        role="status"
        aria-live="polite"
        data-testid="confirmation-expired"
      >
        <Clock className="text-text-tertiary h-12 w-12" aria-hidden="true" />
        <h2 className="text-text-primary text-[22px] leading-tight font-semibold">Link expirado</h2>
        <p className="text-text-secondary text-[15px]">O horario desta sessao ja passou.</p>
      </div>
    );
  }

  // Already responded
  if (result.state === 'already_responded') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        role="status"
        aria-live="polite"
        data-testid="confirmation-already-responded"
      >
        <Info className="text-info-500 h-12 w-12" aria-hidden="true" />
        <h2 className="text-text-primary text-[22px] leading-tight font-semibold">
          Voce ja respondeu
        </h2>
        <p className="text-text-secondary text-[15px]">Esta confirmacao ja foi processada.</p>
      </div>
    );
  }

  // Session cancelled
  if (result.state === 'cancelled') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        role="status"
        aria-live="polite"
        data-testid="confirmation-cancelled"
      >
        <XCircle className="text-danger-500 h-12 w-12" aria-hidden="true" />
        <h2 className="text-text-primary text-[22px] leading-tight font-semibold">
          Sessao cancelada
        </h2>
        <p className="text-text-secondary text-[15px]">
          Esta sessao foi cancelada pela sua psicologa.
        </p>
      </div>
    );
  }

  // Valid token — show session info and confirmation form
  const { data } = result;
  const dateFormatted = formatSessionDateFull(data.date);
  const timeFormatted = formatSessionTime(data.date);

  return (
    <div className="flex flex-col gap-6">
      {/* Session info in Card */}
      <Card>
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-4">
            <h2 className="text-text-primary text-center text-[22px] leading-tight font-semibold">
              Confirmar presenca
            </h2>

            <div className="text-text-secondary text-center text-[15px]">
              <p data-testid="session-date">
                Sessao de {dateFormatted} as {timeFormatted}
              </p>
              <p data-testid="session-psychologist" className="mt-1">
                com {data.psychologistName}
              </p>
              {data.locationName && (
                <p data-testid="session-location" className="text-text-tertiary mt-1 text-sm">
                  {data.locationName}
                  {data.locationAddress ? ` — ${data.locationAddress}` : ''}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation form */}
      <PublicConfirmationForm
        token={token}
        confirmAction={publicConfirmSessionAction}
        declineAction={publicDeclineSessionAction}
      />
    </div>
  );
}
