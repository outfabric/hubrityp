import { redirect } from 'next/navigation';

import { CompleteProfileForm } from '@/modules/oauth';
import { getCurrentProfile } from '@/modules/registration';
import { createServerClient } from '@/shared/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { completeOAuthProfile } from './actions';

// `/onboarding/complete-profile` — shown to OAuth users who have a session
// but no profile yet. Email is read-only (from Google), and full name is
// pre-filled from `user.user_metadata.full_name`. The user completes the
// CRP fields and LGPD consents to create their profile.
//
// Guard: if the user already has a profile row, they don't need this page —
// redirect to the dashboard (or wherever the middleware would send them).
export default async function CompleteProfilePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // If a profile already exists, the user has already completed onboarding.
  // Send them to the dashboard — the middleware will further redirect based
  // on profile status (pending_crp_validation, active, etc.) if needed.
  const existingProfile = await getCurrentProfile(supabase);
  if (existingProfile) {
    redirect('/dashboard');
  }

  const email = user.email ?? '';
  const defaultFullName =
    typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Completar cadastro</CardTitle>
        <CardDescription>
          Preencha os dados profissionais para finalizar seu cadastro.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CompleteProfileForm
          email={email}
          defaultFullName={defaultFullName}
          action={completeOAuthProfile}
        />
      </CardContent>
    </Card>
  );
}
