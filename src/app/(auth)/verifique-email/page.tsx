import { Mail } from 'lucide-react';
import { cookies } from 'next/headers';

import {
  CONFIRM_EMAIL_BODY,
  CONFIRM_EMAIL_TITLE,
} from '@/modules/registration/lib/confirm-email-copy';
import { maskEmail, readPendingEmail } from '@/shared/lib/cookies/pending-email';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { ResendButton } from './resend-button';

// Public route — renders for unauthenticated clients and MUST NOT require or
// assume a session. Gating is owned by `src/middleware.ts:classifyPath()`,
// which classifies `/verifique-email` as a public path (exact match). The page
// reads only the signed, HMAC-verified `hp_pending_email` cookie; a missing or
// tampered cookie is treated as absent (no email line, no crash).
export default async function VerifiqueEmailPage() {
  const cookieStore = await cookies();
  const pendingEmail = readPendingEmail(cookieStore);
  const maskedEmail = pendingEmail ? maskEmail(pendingEmail) : null;

  return (
    <Card data-testid="verifique-email-card">
      <CardHeader className="items-center gap-3 text-center">
        <span
          className="bg-surface-muted text-brand-700 flex size-12 items-center justify-center rounded-full"
          aria-hidden="true"
        >
          <Mail className="size-5" aria-hidden="true" />
        </span>
        <CardTitle>{CONFIRM_EMAIL_TITLE}</CardTitle>
        <p className="text-text-secondary text-sm">{CONFIRM_EMAIL_BODY}</p>
        {maskedEmail ? (
          <p className="text-text-tertiary text-sm" data-testid="verifique-email-address">
            {maskedEmail}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <ResendButton />
      </CardContent>
    </Card>
  );
}
