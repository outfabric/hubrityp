import { redirect } from 'next/navigation';

import { CompleteProfileForm } from '@/modules/oauth';
import { createServerClient } from '@/shared/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { completeOAuthProfile } from './actions';

// `/onboarding/complete-profile` — shown to OAuth users who have a session
// but no profile yet. Email is read-only (from Google), and full name is
// pre-filled from `user.user_metadata.full_name`. The user completes the
// CRP fields and LGPD consents to create their profile.
export default async function CompleteProfilePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
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
