'use client';

// Signup CTA (leaf) — a `/signup` link that preserves UTM params.
// --------------------------------------------------------------------------
// Public-site CTAs that point at `/signup` must carry any `utm_*` (and common
// click-id) params from the current URL so the signup is attributed to its
// originating campaign. The href is computed client-side after hydration so
// the SSR markup stays a stable, crawlable `/signup` and only gains the
// tracking params once `window.location.search` is readable.
//
// UTM values are opaque and never logged here (see `lib/utm`). The target is a
// fixed internal path, so this is not an open-redirect sink.
//
// Rendered via the DS Button with `asChild` so the visual treatment matches the
// other header CTAs; callers pass the Button `variant`/`size`/`className`.

import Link from 'next/link';
import * as React from 'react';

import { withUtmFromLocation } from '@/modules/marketing/lib/utm';
import { Button, type ButtonProps } from '@/shared/ui/button';

const SIGNUP_PATH = '/signup';

export interface SignupCtaProps {
  readonly children: React.ReactNode;
  readonly variant?: ButtonProps['variant'];
  readonly size?: ButtonProps['size'];
  readonly className?: string;
  /** Optional click handler (e.g. to close the mobile menu). */
  readonly onClick?: () => void;
}

export function SignupCta({
  children,
  variant,
  size = 'default',
  className,
  onClick,
}: SignupCtaProps): React.JSX.Element {
  // SSR / first render: stable `/signup`. After hydration, fold in the
  // allowlisted tracking params present on the current URL.
  const [href, setHref] = React.useState(SIGNUP_PATH);

  React.useEffect(() => {
    const next = withUtmFromLocation(SIGNUP_PATH);
    // Deferred to the next frame so it is not a synchronous setState inside the
    // effect body (React Compiler `set-state-in-effect` rule).
    const id = requestAnimationFrame(() => setHref(next));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href} onClick={onClick}>
        {children}
      </Link>
    </Button>
  );
}

SignupCta.displayName = 'SignupCta';
