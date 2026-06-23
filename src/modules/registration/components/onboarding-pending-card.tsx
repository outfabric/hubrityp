import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { ProfileStatus } from '../lib/profile-status';

export type OnboardingPendingCardProps = {
  /**
   * Current profile status. Only `pending_crp_validation` renders content;
   * any other status renders nothing — the page is responsible for
   * redirecting before reaching here.
   */
  status: ProfileStatus;
};

/**
 * OnboardingPendingCard — Server Component that renders the centred
 * onboarding card for `/onboarding/pending`.
 *
 * Responsibilities:
 *   - For `pending_crp_validation`, displays a read-only message explaining
 *     the CRP validation queue and the 24h SLA. No resend button — the user
 *     is already past the email gate.
 *   - For any other status (defensive), renders nothing. `pending_verification`
 *     is no longer served here: with Supabase email confirmation enabled an
 *     unconfirmed user can never hold a session, and resend now lives on the
 *     public `/verifique-email` page. The middleware/page redirects every
 *     non-CRP status before this component is reached.
 */
export function OnboardingPendingCard({ status }: OnboardingPendingCardProps) {
  if (status === ProfileStatus.PendingCrpValidation) {
    return (
      <Card data-testid="onboarding-pending-status">
        <CardHeader>
          <CardTitle>Sua conta está em validação</CardTitle>
          <CardDescription>
            Email confirmado. Agora estamos validando seu registro junto ao Conselho Regional de
            Psicologia. O prazo médio é de até 24 horas e você será notificado por email assim que o
            processo for concluído.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Defensive: any other status (active, suspended, cancelled,
  // pending_verification) means the page was reached in error. The page
  // should have redirected; we render nothing rather than mislead the user.
  return null;
}
