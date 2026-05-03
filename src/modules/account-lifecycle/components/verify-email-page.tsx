'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

// `<VerifyEmailPage/>` is the bloqueante page rendered for users in
// `pending_verification`. It MUST stay a Client Component because the resend
// button drives an async Server Action call and surfaces inline feedback —
// the resend result branches into four UI states. The Server Actions
// themselves are passed in as props (wired from the route shell at
// `src/app/(auth)/auth/verify-email/actions.ts`); the component never imports
// from `@/modules/auth` or `@/modules/account-lifecycle` directly, mirroring
// the pattern already used by `<LoginForm/>` and `<SignupForm/>`. That keeps
// the `'server-only'` chain (logger, supabase server client, account
// lifecycle helpers) out of the browser bundle.

// Discriminated union returned by the resend action. Mirrors the
// `ResendVerificationResult` shape from `@/modules/auth` exactly — the spec
// pins the four error variants, so we re-state them here as a literal
// contract rather than importing the type (importing it from
// `@/modules/auth` would drag the `server-only` graph; importing it from
// the route shell would couple this component to a specific route path that
// the consumer should be able to choose).
export type VerifyEmailResendResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'rate_limited' | 'unauthenticated' | 'unknown' };

export type VerifyEmailPageProps = {
  /** Email address the verification link was sent to. */
  email: string;
  /** Server Action that triggers a resend of the verification email. */
  resendAction: () => Promise<VerifyEmailResendResult>;
  /**
   * Server Action that signs the user out and redirects to /login. Wrapped in
   * a `<form action={...}>` so it works even with JavaScript disabled.
   */
  signOutAction: () => Promise<void>;
};

// One-shot UI state for the resend button. `null` means "nothing to show
// yet" (initial render or after the user kicks off another resend). The
// other states map 1:1 onto the spec's four feedback messages.
type ResendFeedback =
  | { kind: 'idle' }
  | { kind: 'success' }
  | { kind: 'error'; key: 'forbidden' | 'rate_limited' | 'unknown' };

const FEEDBACK_MESSAGES = {
  success: 'Email reenviado com sucesso.',
  forbidden: 'Sua conta não está aguardando verificação.',
  rate_limited: 'Aguarde alguns minutos antes de pedir novamente.',
  unknown: 'Não foi possível reenviar agora. Tente em instantes.',
} as const;

export function VerifyEmailPage({ email, resendAction, signOutAction }: VerifyEmailPageProps) {
  const [feedback, setFeedback] = useState<ResendFeedback>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const handleResendClick = () => {
    // Reset feedback eagerly so the user gets a clear "in progress" cue —
    // the button also disables via `isPending` so a double-click cannot
    // re-enter. We wrap the async action in a transition so React batches
    // the post-resolution state update with any other pending UI work
    // without making this an async event handler (which trips
    // `@typescript-eslint/no-misused-promises`).
    setFeedback({ kind: 'idle' });
    startTransition(async () => {
      try {
        const result = await resendAction();

        if (result.ok) {
          setFeedback({ kind: 'success' });
          return;
        }

        if (result.error === 'unauthenticated') {
          // The session is gone — push the user back to /login. We do this
          // via a full navigation rather than a client-side router push so
          // the next request rebuilds the cookie state from scratch.
          window.location.assign('/login');
          return;
        }

        setFeedback({ kind: 'error', key: result.error });
      } catch {
        // Defensive: a network failure or other unexpected throw maps to
        // `unknown`. The Server Action itself catches its own exceptions,
        // but if it ever throws across the boundary we still want to
        // surface a humane message instead of letting React crash.
        setFeedback({ kind: 'error', key: 'unknown' });
      }
    });
  };

  const feedbackMessage =
    feedback.kind === 'success'
      ? FEEDBACK_MESSAGES.success
      : feedback.kind === 'error'
        ? FEEDBACK_MESSAGES[feedback.key]
        : null;

  // `aria-live="polite"` for the feedback region so screen readers announce
  // the resend outcome without preempting whatever the user is reading.
  // `role="status"` for success and `role="alert"` for errors keeps the
  // semantics distinct.
  const feedbackRole = feedback.kind === 'success' ? 'status' : 'alert';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verifique seu email</CardTitle>
        <CardDescription>
          Enviamos um link de verificação para{' '}
          <span data-testid="verify-email-address" className="text-foreground font-medium">
            {email}
          </span>
          . O link é válido por 24 horas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          onClick={handleResendClick}
          disabled={isPending}
          data-testid="verify-email-resend"
          className="w-full"
        >
          {isPending ? 'Reenviando...' : 'Reenviar email de verificação'}
        </Button>

        {feedbackMessage ? (
          <p
            role={feedbackRole}
            aria-live="polite"
            data-testid="verify-email-feedback"
            className={
              feedback.kind === 'success'
                ? 'text-muted-foreground text-sm'
                : 'text-destructive text-sm'
            }
          >
            {feedbackMessage}
          </p>
        ) : null}

        {/*
          Sign-out is a `<form>` posting to a Server Action so it works even
          without client JavaScript — same approach as the (app) layout
          logout button. We render it as a `ghost` variant so the resend
          stays the visual primary action.
        */}
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            data-testid="verify-email-logout"
            className="w-full"
          >
            Sair
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
