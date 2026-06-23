/**
 * Discriminated union returned by `signInImpl` to the page.
 *
 * Errors are typed string literals — never `Error` instances — so the result
 * stays serializable across the Server Action boundary and consumers can
 * narrow exhaustively.
 *
 * Adding a new variant MUST be done here before the action starts returning
 * it, so the consumer's exhaustive switch keeps compiling.
 */
export type SignInError =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'locked_out'
  | 'requires_password_reset'
  | 'account_unavailable'
  | 'unknown';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: 'locked_out'; lockoutUntil?: string }
  | { ok: false; error: Exclude<SignInError, 'locked_out'> };

/**
 * pt-BR user-facing copy for each `SignInError` variant.
 *
 * The keys MUST match the `SignInError` literal union exactly — adding a new
 * variant without a message here is a TypeScript error at the lookup site,
 * which is the intentional safety net.
 */
export const SIGN_IN_ERROR_MESSAGES: Record<SignInError, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed:
    'Confirme seu e-mail para continuar. Enviamos um link de confirmação para a sua caixa de entrada.',
  locked_out:
    'Conta temporariamente bloqueada por excesso de tentativas. Tente novamente mais tarde ou redefina sua senha.',
  requires_password_reset: 'Por segurança, redefina sua senha antes de entrar.',
  account_unavailable: 'Esta conta não está disponível. Entre em contato com o suporte.',
  unknown: 'Algo deu errado. Tente novamente.',
};

/**
 * Maps a `SignInResult` error to the appropriate pt-BR user-facing copy.
 * Returns `null` for success results.
 */
export function getSignInErrorMessage(result: SignInResult): string | null {
  if (result.ok) return null;
  return SIGN_IN_ERROR_MESSAGES[result.error];
}
