'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/shared/ui/button';

/**
 * Result shape returned by the `resendVerificationEmail` Server Action.
 * Mirrors `ResendVerificationResult` from
 * `@/modules/registration/server/resend-verification`. Accepted as a prop
 * so the route shell stays the single client-facing action surface and
 * tests can inject deterministic stubs.
 */
export type ResendVerificationResult =
  | { ok: true }
  | { ok: false; error: 'invalid_status' | 'rate_limited' | 'unknown' };

/**
 * 60-second cool-down enforced locally in the UI after every successful
 * resend. The Server Action also relies on Supabase's own rate-limiter,
 * but the client-side disable prevents the user from triggering avoidable
 * `rate_limited` responses and matches the spec's pt-BR copy "Reenviar
 * (NNs)".
 */
const COOLDOWN_SECONDS = 60;

const ERROR_COPY = {
  rate_limited: 'Espere um minuto para reenviar.',
  invalid_status: 'Não foi possível reenviar agora.',
  unknown: 'Não foi possível reenviar agora.',
} as const;

const SUCCESS_COPY = 'Email reenviado.';
const DEFAULT_LABEL = 'Reenviar email de verificação';

export type ResendVerificationButtonProps = {
  /** Server Action that performs the resend. */
  action: () => Promise<ResendVerificationResult>;
  /**
   * Override the button's `data-testid`. Defaults to
   * `onboarding-pending-resend-email` which is what the
   * `/onboarding/pending` surface expects; the `/auth/callback` error
   * page passes `auth-callback-resend` instead.
   */
  testId?: string;
  /**
   * Override the inline success region's `data-testid`. Defaults match
   * the `onboarding-pending` surface; callers that reuse the button on
   * other surfaces should override to keep IDs scoped to their surface.
   */
  successTestId?: string;
  /** Override the inline error region's `data-testid`. */
  errorTestId?: string;
};

/**
 * ResendVerificationButton — `'use client'` leaf used by both
 * `/onboarding/pending` (status `pending_verification`) and the
 * `/auth/callback` error page when the verification link is invalid.
 *
 * Behavior contract (per `account-registration/spec.md`):
 *   - Click triggers `action()` inside a transition; while pending,
 *     the button is disabled.
 *   - On `{ ok: true }`, render the success message and start a
 *     60-second cool-down (button stays disabled, label reads
 *     "Reenviar (NNs)" counting down).
 *   - On `{ ok: false, error: 'rate_limited' }`, render pt-BR copy
 *     "Espere um minuto para reenviar.". No cool-down on top of the
 *     existing rate-limit window.
 *   - Other typed errors collapse to a generic pt-BR message.
 */
export function ResendVerificationButton({
  action,
  testId = 'onboarding-pending-resend-email',
  successTestId = 'onboarding-pending-resend-success',
  errorTestId = 'onboarding-pending-resend-error',
}: ResendVerificationButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear any running interval on unmount so we never call `setState`
  // on an unmounted component when the user navigates away mid-cool-down.
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const startCooldown = () => {
    setCooldownRemaining(COOLDOWN_SECONDS);
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => {
      setCooldownRemaining((current) => {
        if (current <= 1) {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const handleClick = () => {
    setSuccessMessage(null);
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setSuccessMessage(SUCCESS_COPY);
          setErrorMessage(null);
          startCooldown();
          return;
        }
        // Rate-limit: re-mention the spec's exact pt-BR copy. We do
        // NOT start the local cool-down on a rate-limit failure — the
        // server-side window already governs.
        setErrorMessage(ERROR_COPY[result.error]);
      } catch {
        // The Server Action contract is "never throws", but a transport
        // failure before the action runs (network drop, RSC stream
        // termination) can still surface as a rejected Promise. Map it
        // to the same generic message as `unknown`.
        setErrorMessage(ERROR_COPY.unknown);
      }
    });
  };

  const isDisabled = isPending || cooldownRemaining > 0;
  const label = cooldownRemaining > 0 ? `Reenviar (${cooldownRemaining}s)` : DEFAULT_LABEL;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        onClick={handleClick}
        disabled={isDisabled}
        data-testid={testId}
      >
        {isPending ? 'Enviando...' : label}
      </Button>
      {successMessage ? (
        <p
          role="status"
          aria-live="polite"
          data-testid={successTestId}
          className="text-success-700 text-sm"
        >
          {successMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid={errorTestId}
          className="text-danger-700 text-sm"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
