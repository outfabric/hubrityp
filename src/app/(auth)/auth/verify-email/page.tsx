import { redirect } from 'next/navigation';

import { getAccountStatus, VerifyEmailPage } from '@/modules/account-lifecycle';
import { createServerClient } from '@/shared/supabase/server';

import { resendVerificationEmail, signOut } from './actions';

// Server Component for `/auth/verify-email`.
//
// Section 7's middleware will be the authoritative gate that bounces non-
// `pending_verification` users away from this route. We still defensively
// check the session + status here so the page never renders the wrong
// content if middleware skips the route — without the check an `active`
// user could see "Verifique seu email" while their account is fully usable,
// which is the same UX trap `/login` solves.
//
// Status routing mirrors `postLoginRedirect`:
//   • no session                  → /login?redirectTo=/auth/verify-email
//   • status `null` (no profile)  → /login (orphan session)
//   • status `pending_verification` → render the page
//   • status `pending_crp_validation` → /auth/crp-review
//   • status `active`             → /dashboard
//   • status `suspended`/`cancelled` → /login?reason=<status>
export default async function VerifyEmailRoutePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/auth/verify-email');
  }

  const { status } = await getAccountStatus(user.id);

  if (status === null) {
    // Orphaned session: the auth user exists but no profile row. The login
    // action also handles this case by signing the user out; the page just
    // bounces to /login so the next request rebuilds the cookie state.
    redirect('/login');
  }

  switch (status) {
    case 'pending_verification':
      // Happy path — render below.
      break;
    case 'pending_crp_validation':
      redirect('/auth/crp-review');
      break;
    case 'active':
      redirect('/dashboard');
      break;
    case 'suspended':
      redirect('/login?reason=suspended');
      break;
    case 'cancelled':
      redirect('/login?reason=cancelled');
      break;
  }

  // The Supabase user record always carries an email for password-based
  // signups (the only signup path the MVP supports). We narrow defensively:
  // an empty email string makes the bloqueante page useless, so we bounce
  // to /login rather than render "Enviamos um link para ".
  const email = user.email ?? '';
  if (!email) {
    redirect('/login');
  }

  return (
    <VerifyEmailPage email={email} resendAction={resendVerificationEmail} signOutAction={signOut} />
  );
}
