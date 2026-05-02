'use server';

import { redirect } from 'next/navigation';

import { logger } from '@/lib/logger';
import { createServerClient } from '@/lib/supabase/server';

// `signOut` is wrapped in `<form action={signOut}>` from the (app) layout, so
// every authenticated page inherits the logout control. The action returns
// `void` because the only observable effect is the redirect — `redirect()`
// throws a `NEXT_REDIRECT` marker which is re-thrown to Next.js to perform
// the navigation.
export async function signOut(): Promise<void> {
  const supabase = await createServerClient();

  // Best effort: we still redirect to /login even if Supabase fails. Clearing
  // the session is idempotent from the user's perspective — the wave-2
  // middleware refreshes the cookie on the next request anyway. Any catch
  // MUST be inside the try block, NOT around `redirect()`, because the
  // `NEXT_REDIRECT` marker has to propagate.
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      logger.warn(
        { event: 'signout_failed', errorName: error.name ?? 'AuthError' },
        'supabase signOut returned an error',
      );
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'signout_unknown_error', errorName: name }, 'supabase signOut threw');
  }

  redirect('/login');
}
