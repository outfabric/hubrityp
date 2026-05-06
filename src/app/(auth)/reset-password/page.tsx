import Link from 'next/link';

import { ResetPasswordForm } from '@/modules/password-recovery';
import { createServerClient } from '@/shared/supabase/server';
import { buttonVariants } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { resetPassword } from './actions';

// `/reset-password` — shown after the user clicks the recovery link in their
// email. The callback route (`/auth/callback`) exchanges the token and
// establishes a recovery session before redirecting here.
//
// Guard: if there is no active session (e.g. the user navigated here
// directly, or the recovery link expired), we render an error UI with a
// link back to `/forgot-password` instead of the form.
export default async function ResetPasswordPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // No session or error retrieving user — the link is invalid/expired.
  if (error || !user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Redefinir senha</CardTitle>
        </CardHeader>
        <CardContent data-testid="reset-password-form-error">
          <p className="text-destructive mb-4 text-sm">Link inválido ou expirado.</p>
          <Link href="/forgot-password" className={buttonVariants({ variant: 'default' })}>
            Solicitar novo link
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redefinir senha</CardTitle>
        <CardDescription>Escolha uma nova senha forte para sua conta.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm action={resetPassword} />
      </CardContent>
    </Card>
  );
}
