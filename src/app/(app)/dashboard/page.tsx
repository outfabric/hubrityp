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
  stampFirstAccess,
  WeeklySummarySlot,
} from '@/modules/dashboard';
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
//   2. Fire-and-forget `stampFirstAccess` — records the day-7 NPS anchor on
//      the first authenticated render. We never block the page on it.
//   3. Fetch the day's data + the empty-state signal in parallel (no waterfall).
//   4. Brand-new user (no patients, no sessions) → the first-steps slot.
//   5. Otherwise → the four sections in order: Hoje, Pendências, Resumo, Ações.
//      Resumo streams inside <Suspense> so the day's data paints first.
export default async function DashboardPage() {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile(supabase);

  if (!profile) {
    redirect('/login');
  }

  if (profile.status !== ProfileStatus.Active) {
    redirect('/onboarding/pending');
  }

  // Idempotent, fire-and-forget. `stampFirstAccess` only writes when
  // `first_access_at` is still NULL; we intentionally do not `await` it so a
  // slow write never delays the first paint. Failures are swallowed (the next
  // render retries) rather than crashing the dashboard.
  void stampFirstAccess(supabase).catch(() => {});

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
