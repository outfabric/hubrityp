import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { Suspense } from 'react';

import { AiRealtimeBoundary } from '@/modules/ai-transcription';
import {
  getUnreadCount,
  listNotifications,
  NotificationBellBoundary,
  type NotificationView,
} from '@/modules/notifications';
import { getNpsEligibility, NpsModal } from '@/modules/nps';
import { onboardingStepSchema, UnfinishedSetupBanner } from '@/modules/onboarding';
import { WhatsAppHealthBanner } from '@/modules/whatsapp';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import {
  dismissNpsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  signOut,
  submitNpsAction,
} from './actions';
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

// Async slot that computes server-side NPS eligibility (from the profile's
// `first_access_at` + `nps_responded_at`) and mounts the day-7 modal. Wrapped in
// <Suspense> so its DB read never blocks the shell. Suppressed on the onboarding
// pages — the survey is a post-onboarding nudge and would clash with the wizard.
// The modal itself renders nothing when ineligible; this slot avoids the read
// entirely on onboarding routes.
async function NpsModalSlot() {
  const pathname = (await headers()).get('x-pathname') ?? '';
  if (pathname.startsWith('/onboarding')) return null;

  const supabase = await createServerClient();
  const isEligible = await getNpsEligibility(supabase);
  if (!isEligible) return null;

  return (
    <NpsModal isEligible={isEligible} onSubmit={submitNpsAction} onDismiss={dismissNpsAction} />
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

  // Seed the bell server-side. Both reads are owner-scoped (getUser() inside the
  // module impls) and independent, so fetch them in parallel — no waterfall. An
  // unauthenticated request yields an empty bell rather than blocking the shell.
  const [listResult, unreadResult] = await Promise.all([
    listNotifications(supabase),
    getUnreadCount(supabase),
  ]);
  const initialNotifications: NotificationView[] = listResult.ok ? listResult.notifications : [];
  const initialUnreadCount = unreadResult.ok ? unreadResult.count : 0;

  return (
    <div className="flex min-h-svh flex-col">
      <AiRealtimeBoundary userId={userId} />
      <header className="border-border bg-surface flex items-center justify-between border-b px-6 py-3 pl-14 md:pl-6">
        <span className="text-lg font-semibold">HubrityP</span>
        <div className="flex items-center gap-2">
          <NotificationBellBoundary
            userId={userId}
            notifications={initialNotifications}
            initialUnreadCount={initialUnreadCount}
            markRead={markNotificationReadAction}
            markAllRead={markAllNotificationsReadAction}
          />
          <form action={signOut}>
            <Button type="submit" variant="ghost" data-testid="dashboard-logout">
              Sair
            </Button>
          </form>
        </div>
      </header>
      <Suspense>
        <UnfinishedSetupBannerSlot />
      </Suspense>
      <Suspense>
        <WhatsAppHealthBanner />
      </Suspense>
      <Suspense>
        <NpsModalSlot />
      </Suspense>
      <div className="flex flex-1">
        <SidebarNav />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
