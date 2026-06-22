import Link from 'next/link';
import { redirect } from 'next/navigation';

import { stampFirstAccess } from '@/modules/dashboard';
import { getCurrentProfile, ProfileStatus } from '@/modules/registration';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { SkipOnboardingLink } from './skip-onboarding-link';

// `/onboarding/welcome` — first step of the guided setup wizard.
//
// Gating: `middleware.ts:classifyPath()` maps `/onboarding/welcome` to the
// 'app' (gated) class, so anonymous requests are redirected to
// `/login?redirectTo=%2Fonboarding%2Fwelcome` and non-`active` profiles are
// bounced to `/onboarding/pending` BEFORE this Server Component renders. The
// guards below are defense-in-depth — they mirror the middleware's redirect
// targets so a future middleware bypass cannot leak a partial UI.
export default async function OnboardingWelcomePage() {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile(supabase);

  if (!profile) {
    redirect('/login');
  }

  if (profile.status !== ProfileStatus.Active) {
    redirect('/onboarding/pending');
  }

  // Idempotent, fire-and-forget `first_access_at` stamp. The welcome screen is
  // the wizard's entry point and the true first authenticated destination for an
  // active psychologist with incomplete onboarding (the soft gate routes here
  // before the dashboard), so stamping here — instead of on /dashboard — keeps
  // the day-7 NPS anchor at the real first access. The write only fires when
  // `first_access_at IS NULL`; we never `await` it (a slow write must not delay
  // the first paint) and swallow failures (the next render retries).
  void stampFirstAccess(supabase).catch(() => {});

  // First name only — `fullName` is "Marina Costa" → "Marina". A profile with
  // an empty/whitespace name (should not happen: the column is NOT NULL) falls
  // back to a neutral greeting rather than rendering "Olá, !".
  const firstName = profile.fullName.trim().split(/\s+/)[0] ?? '';

  // Reactivated accounts (a previously-cancelled profile brought back online)
  // get a "welcome-back" copy variant. `reactivatedAt` is null for new signups.
  const isReactivated = profile.reactivatedAt !== null;

  const heading = isReactivated
    ? firstName
      ? `Bem-vindo de volta, ${firstName}!`
      : 'Bem-vindo de volta!'
    : firstName
      ? `Olá, ${firstName}! Tudo pronto para começar.`
      : 'Tudo pronto para começar.';

  const intro = isReactivated
    ? 'Que bom ter você de volta. Vamos retomar a configuração da sua conta em poucos minutos.'
    : 'Vamos deixar sua conta pronta em poucos passos. Você pode pular e explorar por conta própria a qualquer momento.';

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1
          className="text-text-primary text-2xl font-semibold"
          data-testid="onboarding-welcome-heading"
        >
          {heading}
        </h1>
        <p className="text-text-secondary text-base">{intro}</p>
      </div>

      <div className="flex flex-col items-start gap-3">
        <Button asChild size="lg" data-testid="onboarding-start-btn">
          <Link href="/onboarding/setup/profile">Começar configuração (5 min)</Link>
        </Button>
        <SkipOnboardingLink />
      </div>
    </div>
  );
}
