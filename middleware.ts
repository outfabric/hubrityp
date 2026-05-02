import { type NextRequest } from 'next/server';

import { createMiddlewareClient } from './lib/supabase/middleware';

// Root middleware: refresh the Supabase session cookie on every navigation so
// the server-side renderer always sees an up-to-date session. Auth gating
// (redirects for unauthenticated users) is intentionally NOT done here in
// wave 2 — it arrives in wave 3 along with the first auth UI.
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals, static assets, and the favicon — middleware
    // would otherwise add cookie-set overhead to every fetched chunk.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
