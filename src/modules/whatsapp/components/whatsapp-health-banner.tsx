import 'server-only';

import { eq } from 'drizzle-orm';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { db } from '@/shared/db/client';
import { reminderSettings, whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';
import { createServerClient } from '@/shared/supabase/server';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

/**
 * Server Component that renders a persistent danger banner when the
 * psychologist's WhatsApp connection is broken (`status = 'error'`) AND
 * at least one reminder is enabled in `reminder_settings`.
 *
 * Renders `null` when the conditions are not met, so it can be placed
 * unconditionally in the `(app)` layout without affecting the DOM.
 */
export async function WhatsAppHealthBanner() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Parallel queries — no waterfall.
  const [accountRows, settingsRows] = await Promise.all([
    db
      .select({ status: whatsappAccounts.status })
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.userId, user.id))
      .limit(1),
    db
      .select({
        earlyReminderHours: reminderSettings.earlyReminderHours,
        finalReminderHours: reminderSettings.finalReminderHours,
        videoLinkMinutes: reminderSettings.videoLinkMinutes,
      })
      .from(reminderSettings)
      .where(eq(reminderSettings.userId, user.id))
      .limit(1),
  ]);

  const account = accountRows[0];
  const settings = settingsRows[0];

  // Banner is only visible when the WA account is in error state AND at
  // least one reminder type is enabled (early or final not null, or video
  // link minutes exists — which is always non-null when the row is present).
  if (account?.status !== 'error') return null;
  if (!settings) return null;

  const hasAnyReminderEnabled =
    settings.earlyReminderHours !== null ||
    settings.finalReminderHours !== null ||
    settings.videoLinkMinutes !== null;

  if (!hasAnyReminderEnabled) return null;

  return (
    <Alert variant="danger" role="alert" aria-live="assertive" data-testid="whatsapp-health-banner">
      <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>Sua conexão com WhatsApp expirou. Lembretes não estão sendo enviados.</span>
        <Button variant="link" size="sm" asChild className="text-danger-700 shrink-0">
          <Link href="/configuracoes/integracoes/whatsapp">Reconectar</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
