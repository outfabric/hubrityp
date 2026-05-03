import { mapSupabaseUser } from '@/modules/auth';
import { createServerClient } from '@/shared/supabase/server';

// Server Component. Middleware (wave 3) is the authoritative gate that
// redirects anonymous requests to /login, so reaching this render almost
// always means there is a user. We still defensively handle `user === null`
// by returning `null` — middleware bypass would otherwise leak a partial UI.
export default async function DashboardPage() {
  const supabase = await createServerClient();
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();
  const user = mapSupabaseUser(supabaseUser);

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Painel</h1>
      <span data-testid="dashboard-greeting">Olá, {user.email}</span>
    </div>
  );
}
