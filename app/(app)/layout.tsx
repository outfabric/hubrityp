import { Button } from '@/components/ui/button';

import { signOut } from './actions';

// Authenticated shell: every page under (app) inherits this header (with the
// logout control) and the main content area. The logout `<form action={...}>`
// works without client JavaScript — submitting POSTs to the Server Action
// directly, which then redirects to /login.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border bg-surface flex items-center justify-between border-b px-6 py-3">
        <span className="text-lg font-semibold">HubrityP</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" data-testid="dashboard-logout">
            Sair
          </Button>
        </form>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
