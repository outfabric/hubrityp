'use client';

import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';

import { clientEnv } from '@/shared/env/client';

export function createBrowserClient() {
  return createSsrBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
