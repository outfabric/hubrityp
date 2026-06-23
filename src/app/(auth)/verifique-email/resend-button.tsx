'use client';

import { useState, useTransition } from 'react';

// The copy constants module is a pure strings-only module explicitly documented
// as safe to import from both Server and Client Components, so we pull the
// acknowledgement directly from the leaf path (NOT the barrel, which re-exports
// Server Actions).
import { RESEND_CONFIRMATION_ACK } from '@/modules/registration/lib/confirm-email-copy';
import { Button } from '@/shared/ui/button';

// The `resendPublicConfirmation` Server Action is consumed from the route shell
// at `./actions` (a `'use server'` file). Client Components MUST import Server
// Actions from a file carrying the `'use server'` directive — only then does
// Next.js compile the import into a client-safe RPC stub. Importing the impl
// from the `@/modules/registration` barrel instead would drag its
// `import 'server-only'` chain (Drizzle, Supabase server client, logger) into
// the browser bundle and the RSC boundary checker would refuse the build.
import { resendPublicConfirmation } from './actions';

/**
 * Client leaf for the public `/verifique-email` resend control.
 *
 * Renders the primary "reenviar" button with a mandatory loading state and an
 * `aria-live="polite"` feedback region. On click it calls the public,
 * enumeration-safe `resendPublicConfirmation` Server Action (which derives the
 * target email solely from the signed `hp_pending_email` cookie, never from
 * client input) and then renders the generic, neutral acknowledgement —
 * regardless of the Supabase outcome — so the page never reveals whether an
 * account exists for the address. The feedback is informational only; it never
 * uses `danger` styling.
 */
export function ResendButton() {
  const [isPending, startTransition] = useTransition();
  // Discriminated state: the acknowledgement is shown only after a completed
  // resend attempt; before that the feedback region stays empty.
  const [acknowledged, setAcknowledged] = useState(false);

  function handleResend() {
    startTransition(async () => {
      // The action is enumeration-safe and always resolves to `{ ok: true }`;
      // we surface the same neutral acknowledgement regardless of the result.
      await resendPublicConfirmation();
      setAcknowledged(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="default"
        size="default"
        className="w-full"
        disabled={isPending}
        onClick={handleResend}
        data-testid="verifique-email-resend"
      >
        {isPending ? 'Reenviando...' : 'Reenviar link de confirmação'}
      </Button>

      {/* Feedback region — informational/neutral, never `danger`. Always
          present in the DOM so screen readers announce the acknowledgement
          when it appears. */}
      <p
        aria-live="polite"
        data-testid="verifique-email-feedback"
        className="text-text-secondary min-h-5 text-sm"
      >
        {acknowledged ? RESEND_CONFIRMATION_ACK : ''}
      </p>
    </div>
  );
}
