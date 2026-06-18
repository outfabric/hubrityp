import Link from 'next/link';
import * as React from 'react';

import { Logo } from '@/shared/ui/logo';

import { Container } from './container';

/**
 * PublicHeader — placeholder banner for the public site.
 *
 * INTERIM: this renders the brand logo only. The full marketing header
 * (navigation, auth-aware CTAs, theme toggle) ships in the `public-header`
 * change (section 6). It is kept deliberately minimal and stateless so it
 * remains a Server Component and never fetches or renders any authenticated
 * data — the public layout exposes only a boolean "is authenticated" once the
 * real header lands.
 *
 * The single `role="banner"` (implicit on `<header>`) is the only banner
 * landmark on the page.
 */
export function PublicHeader(): React.JSX.Element {
  return (
    <header className="border-border-subtle border-b py-4">
      <Container className="flex items-center">
        <Link href="/" aria-label="Hubrity — página inicial">
          <Logo variant="lockup-h" className="h-8 w-auto" />
        </Link>
      </Container>
    </header>
  );
}

PublicHeader.displayName = 'PublicHeader';
