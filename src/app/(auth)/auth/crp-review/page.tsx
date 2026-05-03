import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { CrpReviewPage, getAccountStatus } from '@/modules/account-lifecycle';
import { db } from '@/shared/db/client';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';
import { createServerClient } from '@/shared/supabase/server';

import { signOut } from './actions';

// Hardcoded contact email for the MVP. The spec keeps this as a prop on
// `<CrpReviewPage/>` for testability (so unit tests can assert the value
// is rendered without depending on env state); we resolve the actual
// production value here. When the contact email needs to vary (e.g. per
// tenant) this becomes an env-driven lookup; for now the constant is
// fine and a single edit point.
const CONTACT_EMAIL = 'suporte@hubrityp.com.br';

// Server Component for `/auth/crp-review`.
//
// Section 7's middleware will be the authoritative gate that bounces non-
// `pending_crp_validation` users away from this route. We still defensively
// check the session + status here so the page never renders the wrong
// content if middleware skips the route. Mirrors the verify-email page
// status routing; only the happy-path branch differs.
//
// Status routing:
//   • no session                  → /login?redirectTo=/auth/crp-review
//   • status `null` (no profile)  → /login (orphan session)
//   • status `pending_verification` → /auth/verify-email
//   • status `pending_crp_validation` → render the page
//   • status `active`             → /dashboard
//   • status `suspended`/`cancelled` → /login?reason=<status>
export default async function CrpReviewRoutePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/auth/crp-review');
  }

  const { status } = await getAccountStatus(user.id);

  if (status === null) {
    redirect('/login');
  }

  switch (status) {
    case 'pending_crp_validation':
      // Happy path — render below.
      break;
    case 'pending_verification':
      redirect('/auth/verify-email');
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

  // Read CRP fields directly. We don't add a getter to the module surface
  // because this is the only consumer today and the surface stays minimal;
  // when a second consumer appears we should extract a typed helper. The
  // RLS policy on `psychologist_profiles` would scope this anyway, but the
  // server-side anon-key client we use here doesn't propagate the JWT to
  // Drizzle — the query is owner-scoped by `eq(userId)` instead. Both
  // tracks land on the same row.
  const rows = await db
    .select({
      crpNumber: psychologistProfiles.crpNumber,
      crpUf: psychologistProfiles.crpUf,
    })
    .from(psychologistProfiles)
    .where(eq(psychologistProfiles.userId, user.id))
    .limit(1);

  const profile = rows[0];

  // Defensive: `getAccountStatus` returned a non-null status, so the row
  // existed at that read. A race where the row was deleted between the
  // status read and this query is essentially impossible in practice
  // (the LGPD job nukes the auth user too), but if it ever happens we
  // fall back to /login rather than render undefined values.
  if (!profile) {
    redirect('/login');
  }

  return (
    <CrpReviewPage
      crpNumber={profile.crpNumber}
      crpUf={profile.crpUf}
      contactEmail={CONTACT_EMAIL}
      signOutAction={signOut}
    />
  );
}
