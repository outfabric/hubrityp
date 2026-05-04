import { redirect } from 'next/navigation';

import { getCurrentProfile, ProfileStatus } from '@/modules/registration';
import { createServerClient } from '@/shared/supabase/server';

// Server Component. Middleware (section 8) is the authoritative gate that
// redirects anonymous requests to /login and any non-`active` profile to
// /onboarding/pending, so reaching this render almost always means there is
// a session whose profile resolves to `active`.
//
// The `null` / non-active branches below are defense-in-depth — they should
// never trigger in practice, but they prevent leaking a partial UI if a
// future refactor accidentally bypasses middleware. We mirror middleware's
// redirect targets so the user lands on the same place they would have
// landed via the gate.
export default async function DashboardPage() {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile(supabase);

  if (!profile) {
    redirect('/login');
  }

  if (profile.status !== ProfileStatus.Active) {
    redirect('/onboarding/pending');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Painel</h1>
      <span data-testid="dashboard-greeting">Olá, {profile.fullName}</span>
    </div>
  );
}
