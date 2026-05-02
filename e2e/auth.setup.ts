import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { test as setup } from '@playwright/test';

// Programmatic signin: writes a simulated `supabase.auth.token` cookie into
// `e2e/.auth/state.json`. Tests that need an authenticated session load this
// state via `test.use({ storageState: 'e2e/.auth/state.json' })`. No real
// gotrue handshake is performed — that lives in the `@auth-real` suite,
// reserved for wave 3.
const STATE_PATH = path.resolve(__dirname, '.auth/state.json');

setup('write simulated auth state', async () => {
  const fakeToken = JSON.stringify({
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expires_at: Date.now() / 1000 + 60 * 60 * 24,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'seed@example.com',
      role: 'authenticated',
    },
  });

  const state = {
    cookies: [
      {
        name: 'supabase.auth.token',
        value: encodeURIComponent(fakeToken),
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
});
