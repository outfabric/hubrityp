import Link from 'next/link';

import { Container } from '@/modules/marketing';
import { Button } from '@/shared/ui/button';

/**
 * Public 404 — rendered for any unknown path inside the `(public)` group.
 *
 * Wrapped by the `(public)` layout (header + main + footer), so the brand
 * chrome is preserved. An unknown path renders this 404 and never redirects to
 * login (the middleware classifies unmatched paths as `public` and passes
 * through).
 *
 * Layout: large "404" in `brand/600`, a short message, then a primary CTA
 * ("Criar conta grátis" -> /signup) and a secondary CTA ("Voltar para a
 * homepage" -> /).
 */
export default function NotFound() {
  return (
    <Container className="flex flex-col items-center py-24 text-center">
      <p className="text-brand-600 text-display-xl font-semibold" aria-hidden="true">
        404
      </p>
      <h1 className="text-text-primary text-display-md mt-4">Página não encontrada</h1>
      <p className="text-text-secondary mt-3 max-w-prose">
        A página que você procura não existe ou foi movida.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/signup">Criar conta grátis</Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href="/">Voltar para a homepage</Link>
        </Button>
      </div>
    </Container>
  );
}
