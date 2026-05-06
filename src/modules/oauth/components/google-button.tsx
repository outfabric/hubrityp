'use client';

import { useState } from 'react';

import { createBrowserClient } from '@/shared/supabase/client';
import { Button } from '@/shared/ui/button';

// GoogleButton initiates the Google OAuth sign-in flow on the client side.
// It calls `supabase.auth.signInWithOAuth` which redirects the browser to
// Google's consent screen. After the user consents, Google redirects back
// to `/auth/callback?code=...` where the server-side callback route handles
// session creation and profile branching.
//
// This component is intentionally stateless beyond a loading flag — there is
// no server round-trip from the button click; the browser navigates directly
// to Google via the Supabase SDK.

export function GoogleButton() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleClick() {
    setIsLoading(true);

    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: 'select_account' },
        },
      });

      if (error) {
        // The SDK should have navigated away on success. If we reach here
        // with an error, the redirect never happened. Reset the loading state.
        setIsLoading(false);
      }
      // On success the browser navigates away, so we don't need to reset
      // isLoading — the component unmounts.
    } catch {
      setIsLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={isLoading}
      data-testid="login-form-google-button"
      onClick={() => {
        void handleClick();
      }}
    >
      {isLoading ? 'Redirecionando...' : 'Entrar com Google'}
    </Button>
  );
}
