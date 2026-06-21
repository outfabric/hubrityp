import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import {
  DashboardSecondary,
  FirstStepsSlot,
  getPendencias,
  getTodaySessions,
  hasAnyData,
  SectionPendencias,
  SectionToday,
  SectionWeeklySkeleton,
  WeeklySummarySlot,
} from '@/modules/dashboard';
import { ChecklistSlot } from '@/modules/onboarding';
import { getCurrentProfile, ProfileStatus } from '@/modules/registration';
import { createServerClient } from '@/shared/supabase/server';

// Operational home for the authenticated psychologist.
//
// Middleware (section 8) is the authoritative gate: it redirects anonymous
// requests to /login and any non-`active` profile to /onboarding/pending, so
// reaching this render almost always means there is a session whose profile
// resolves to `active`. The `null` / non-active branches below are
// defense-in-depth — they should never trigger in practice, but they prevent
// leaking a partial dashboard if a future refactor accidentally bypasses the
// gate. We mirror middleware's redirect targets so the user lands where they
// would have via the gate.
//
// Composition (in render order):
//   1. Authenticate + authorize the profile (defense in depth).
//   2. Fetch the day's data + the empty-state signal in parallel (no waterfall).
//   3. Brand-new user (no patients, no sessions) → the first-steps slot.
//   4. Otherwise → the four sections in order: Hoje, Pendências, Resumo, Ações.
//      Resumo streams inside <Suspense> so the day's data paints first.
//
// NOTE: `first_access_at` is stamped at the WIZARD entry (/onboarding/welcome
// and /onboarding/setup), NOT here. Active psychologists with incomplete
// onboarding are routed to the wizard before the dashboard, so stamping there
// records the true first authenticated destination for the day-7 NPS anchor.
export default async function DashboardPage() {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile(supabase);

  if (!profile) {
    redirect('/login');
  }

  if (profile.status !== ProfileStatus.Active) {
    redirect('/onboarding/pending');
  }

  // Independent reads run together — no waterfall. Each helper authenticates
  // via getUser() and scopes to auth.uid() internally.
  const [todayResult, pendenciasResult, hasDataResult] = await Promise.all([
    getTodaySessions(supabase),
    getPendencias(supabase),
    hasAnyData(supabase),
  ]);

  // Defense in depth: if any helper reports an invalid session, do not render a
  // partial dashboard — mirror the middleware's anonymous redirect.
  if (!todayResult.ok || !pendenciasResult.ok || !hasDataResult.ok) {
    redirect('/login');
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Painel</h1>
        <span className="text-text-secondary text-sm" data-testid="dashboard-greeting">
          Olá, {profile.fullName}
        </span>
      </header>

      {/* First-run onboarding checklist — renders at the top whenever a
          mandatory item is still pending, and disappears once setup is 100%
          complete (`hideWhenComplete`). Streams inside <Suspense> so its
          recompute never blocks the day's data from painting. */}
      <Suspense fallback={null}>
        <ChecklistSlot hideWhenComplete />
      </Suspense>

      {!hasDataResult.hasAnyData ? (
        <FirstStepsSlot />
      ) : (
        <>
          {/* Hoje + Pendências always lead, at every viewport width. */}
          <SectionToday result={todayResult} />
          <SectionPendencias result={pendenciasResult} />

          {/* Resumo (inside <Suspense>) + Ações — collapsed behind a chevron on
              mobile by the client wrapper; always shown from md up. */}
          <DashboardSecondary
            weekly={
              <Suspense fallback={<SectionWeeklySkeleton />}>
                <WeeklySummarySlot />
              </Suspense>
            }
          />
        </>
      )}
    </div>
  );
}
