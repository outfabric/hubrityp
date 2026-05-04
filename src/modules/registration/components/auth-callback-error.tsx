import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import {
  ResendVerificationButton,
  type ResendVerificationResult,
} from './resend-verification-button';

export type AuthCallbackErrorProps = {
  /**
   * Server Action that resends the verification email. Best-effort on
   * this surface: the user reaching `/auth/callback` after a failure
   * may not even have a session, in which case the action returns
   * `{ ok: false, error: 'invalid_status' }` and the button surfaces a
   * generic pt-BR copy directing the user to log in or sign up again.
   *
   * Optional — when omitted, the resend control is not rendered. The
   * route shell decides whether to wire it based on the session state.
   */
  resendAction?: () => Promise<ResendVerificationResult>;
};

/**
 * AuthCallbackError — error UI for `/auth/callback` when the
 * verification code is missing, expired, or tampered with.
 *
 * pt-BR copy follows `account-registration/spec.md`:
 *   "O link de verificação expirou ou é inválido. Solicite um novo email."
 *
 * The resend button is **best-effort**: if the user has no session
 * (typical when arriving via an expired link), the action returns
 * `invalid_status` and the button's generic error message tells them to
 * sign in or sign up again. This component is rendered as a Server
 * Component shell wrapping the `ResendVerificationButton` Client leaf,
 * mirroring the `OnboardingPendingCard` composition pattern.
 */
export function AuthCallbackError({ resendAction }: AuthCallbackErrorProps) {
  return (
    <Card data-testid="auth-callback-error">
      <CardHeader>
        <CardTitle>Não foi possível verificar seu email</CardTitle>
        <CardDescription>
          O link de verificação expirou ou é inválido. Solicite um novo email de verificação para
          continuar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resendAction ? (
          <ResendVerificationButton
            action={resendAction}
            testId="auth-callback-resend"
            successTestId="auth-callback-resend-success"
            errorTestId="auth-callback-resend-error"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
