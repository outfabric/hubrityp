import { redirect } from 'next/navigation';

import { SignupForm } from '@/modules/auth';
import { createServerClient } from '@/shared/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { signUp } from './actions';

// Server Component for `/signup`.
//
// Middleware (section 7 of `add-account-signup-and-lifecycle`) is the
// authoritative gate that bounces authenticated users away from `/signup`.
// We still defensively check the session here so the same-user path keeps
// working if middleware ever skips this route — without the check an
// authenticated user could see the cadastro form while their session is
// still valid, which is the same UX trap `/login` solves.
export default async function SignupPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Hand off to /dashboard so the account-lifecycle middleware can route
    // by status (verify-email, crp-review, dashboard, ...). Mirrors the
    // login page semantics exactly: middleware decides where the user
    // actually lands; the page just refuses to render the cadastro form
    // for an already-signed-in identity.
    redirect('/dashboard');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar conta</CardTitle>
        <CardDescription>
          Cadastre-se como psicólogo para começar a usar o HubrityP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm action={signUp} />
      </CardContent>
    </Card>
  );
}
