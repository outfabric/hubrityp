import { Suspense } from 'react';

import { AiRealtimeBoundary } from '@/modules/ai-transcription';
import { WhatsAppHealthBanner } from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { signOut } from './actions';
import { SidebarNav } from './sidebar-nav';

// Authenticated shell: every page under (app) inherits this header (with the
// logout control), the sidebar navigation, and the main content area. The
// logout `<form action={...}>` works without client JavaScript — submitting
// POSTs to the Server Action directly, which then redirects to /login.
//
// The WhatsAppHealthBanner is rendered above the main content area so the
// psychologist always sees the warning when the WA connection is broken and
// reminders are enabled. Wrapped in Suspense to avoid blocking the layout.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Resolve the authenticated user id server-side (GoTrue-validated) so the
  // realtime boundary subscribes to the correct per-user channel. We use
  // getUser() — never getSession() — even though no authorization decision is
  // made here; the middleware is the authoritative gate. A null id (no/invalid
  // session) makes the boundary a no-op rather than subscribing to a stray
  // channel.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  return (
    <div className="flex min-h-svh flex-col">
      <AiRealtimeBoundary userId={userId} />
      <header className="border-border bg-surface flex items-center justify-between border-b px-6 py-3 pl-14 md:pl-6">
        <span className="text-lg font-semibold">HubrityP</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" data-testid="dashboard-logout">
            Sair
          </Button>
        </form>
      </header>
      <Suspense>
        <WhatsAppHealthBanner />
      </Suspense>
      <div className="flex flex-1">
        <SidebarNav />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
