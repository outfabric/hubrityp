import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { Suspense } from 'react';

import { AiRealtimeBoundary } from '@/modules/ai-transcription';
import { onboardingStepSchema, UnfinishedSetupBanner } from '@/modules/onboarding';
import { WhatsAppHealthBanner } from '@/modules/whatsapp';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { signOut } from './actions';
import { SidebarNav } from './sidebar-nav';

// Async slot that reads the authenticated psychologist's onboarding state and
// renders the unfinished-setup banner. Wrapped in <Suspense> by the layout so
// its DB read never blocks the shell. Returns `null` (no banner) when the user
// is unauthenticated, when the profile/onboarding state cannot be resolved, or
// when the current request is itself an onboarding page (the wizard already
// shows progress — a "continue setup" banner there would be noise).
async function UnfinishedSetupBannerSlot() {
  // Suppress on the wizard's own pages. `x-pathname` is injected by
  // `middleware.ts` (the framework does not expose the path to layouts).
  const pathname = (await headers()).get('x-pathname') ?? '';
  if (pathname.startsWith('/onboarding')) return null;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Owner-scoped read: `user.id` is GoTrue-validated (never client-supplied),
  // so the `WHERE user_id = user.id` predicate cannot widen access. RLS is the
  // backstop on top of this explicit scope.
  const rows = await db
    .select({
      onboardingStep: profiles.onboardingStep,
      onboardingCompletedAt: profiles.onboardingCompletedAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const profile = rows[0];
  if (!profile) return null;

  // The column is `text` at the DB level; narrow it to the OnboardingStep
  // union. An unexpected value (should never happen given the CHECK
  // constraint) renders no banner rather than a broken resume link.
  const parsedStep = onboardingStepSchema.safeParse(profile.onboardingStep);
  if (!parsedStep.success) return null;

  return (
    <UnfinishedSetupBanner
      onboardingStep={parsedStep.data}
      onboardingCompletedAt={profile.onboardingCompletedAt}
    />
  );
}

// Authenticated shell: every page under (app) inherits this header (with the
// logout control), the sidebar navigation, and the main content area. The
// logout `<form action={...}>` works without client JavaScript — submitting
// POSTs to the Server Action directly, which then redirects to /login.
//
// The WhatsAppHealthBanner is rendered above the main content area so the
// psychologist always sees the warning when the WA connection is broken and
// reminders are enabled. Wrapped in Suspense to avoid blocking the layout.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Resolve the authenticated user id server-side (GoTrue-validated) so the
  // realtime boundary subscribes to the correct per-user channel. We use
  // getUser() — never getSession() — even though no authorization decision is
  // made here; the middleware is the authoritative gate. A null id (no/invalid
  // session) makes the boundary a no-op rather than subscribing to a stray
  // channel.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  return (
    <div className="flex min-h-svh flex-col">
      <AiRealtimeBoundary userId={userId} />
      <header className="border-border bg-surface flex items-center justify-between border-b px-6 py-3 pl-14 md:pl-6">
        <span className="text-lg font-semibold">HubrityP</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" data-testid="dashboard-logout">
            Sair
          </Button>
        </form>
      </header>
      <Suspense>
        <UnfinishedSetupBannerSlot />
      </Suspense>
      <Suspense>
        <WhatsAppHealthBanner />
      </Suspense>
      <div className="flex flex-1">
        <SidebarNav />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
