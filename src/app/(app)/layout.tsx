import { Suspense } from 'react';

import { WhatsAppHealthBanner } from '@/modules/whatsapp';
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
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
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
