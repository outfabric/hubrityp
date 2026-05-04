import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { ProfileStatus } from '../lib/profile-status';

import {
  ResendVerificationButton,
  type ResendVerificationResult,
} from './resend-verification-button';

export type OnboardingPendingCardProps = {
  /**
   * Current profile status. The card renders different content for each
   * pending status; if a non-pending status is ever passed (defensive
   * call site), the component renders nothing — the page should have
   * redirected before reaching here.
   */
  status: ProfileStatus;
  /** Authenticated user's email; rendered in the verification copy. */
  email: string;
  /**
   * Server Action that resends the verification email. Required only
   * when `status === 'pending_verification'`. The route shell wires the
   * production action; tests inject a stub.
   */
  resendAction?: () => Promise<ResendVerificationResult>;
};

/**
 * OnboardingPendingCard — Server Component that renders the centred
 * onboarding card for `/onboarding/pending`.
 *
 * Responsibilities:
 *   - For `pending_verification`, instructs the user to click the
 *     verification link sent to `email` and embeds the resend button as
 *     a Client leaf.
 *   - For `pending_crp_validation`, displays a read-only message
 *     explaining the CRP validation queue and the 24h SLA. No resend
 *     button — the user is already past the email gate.
 *   - For any other status (defensive), renders nothing. The page must
 *     not reach this component for active/suspended/cancelled users —
 *     the middleware is responsible for the redirect.
 */
export function OnboardingPendingCard({ status, email, resendAction }: OnboardingPendingCardProps) {
  if (status === ProfileStatus.PendingVerification) {
    return (
      <Card data-testid="onboarding-pending-status">
        <CardHeader>
          <CardTitle>Confirme seu email para continuar</CardTitle>
          <CardDescription>
            Enviamos um link de confirmação para <strong>{email}</strong>. Clique no link recebido
            para ativar sua conta. Se não encontrar o email, verifique a caixa de spam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {resendAction ? <ResendVerificationButton action={resendAction} /> : null}
        </CardContent>
      </Card>
    );
  }

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

  // Defensive: any other status (active, suspended, cancelled) means the
  // page was reached in error. The middleware should have redirected;
  // we simply render nothing rather than mislead the user.
  return null;
}
