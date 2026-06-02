'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';

import { skipOnboarding } from './actions';

/**
 * Client leaf for the "Pular e explorar por conta própria" secondary link.
 *
 * Clicking it runs the `skipOnboarding` Server Action (which advances
 * `onboarding_step` to `'done'` server-side, authorized by `auth.uid()`),
 * then client-navigates to `/dashboard`. We use `useTransition` to keep the
 * link disabled while the action is in flight, preventing a double-skip.
 *
 * On failure we surface a human error toast and stay on the page — the user
 * can retry or use the primary CTA instead. No PII is handled here; the action
 * takes no input.
 */
export function SkipOnboardingLink() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSkip() {
    startTransition(async () => {
      const result = await skipOnboarding();
      if (!result.ok) {
        toast.error('Não foi possível pular agora. Tente novamente.');
        return;
      }
      router.push('/dashboard');
    });
  }

  return (
    <Button
      type="button"
      variant="link"
      onClick={handleSkip}
      disabled={isPending}
      data-testid="onboarding-skip-link"
    >
      Pular e explorar por conta própria
    </Button>
  );
}
