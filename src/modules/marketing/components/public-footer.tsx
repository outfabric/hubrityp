import * as React from 'react';

import { Container } from './container';

/**
 * PublicFooter — placeholder contentinfo for the public site.
 *
 * INTERIM: this renders a minimal copyright line. The full marketing footer
 * (nav columns, legal links, social) ships in the `public-footer` change
 * (section 7). Stateless Server Component — no authenticated data.
 *
 * The single `role="contentinfo"` (implicit on `<footer>`) is the only
 * contentinfo landmark on the page.
 *
 * The copyright year is derived from the build/render time on the server; it
 * is not user input and carries no PII.
 */
export function PublicFooter(): React.JSX.Element {
  const year = new Date().getFullYear();

  return (
    <footer className="border-border-subtle border-t py-8">
      <Container>
        <p className="text-text-tertiary text-sm font-medium">
          © {year} Hubrity — Plataforma para psicólogos
        </p>
      </Container>
    </footer>
  );
}

PublicFooter.displayName = 'PublicFooter';
