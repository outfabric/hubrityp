import Link from 'next/link';
import * as React from 'react';

import {
  Container,
  MAIN_CONTENT_ID,
  PublicFooter,
  PublicHeader,
  SkipLink,
} from '@/modules/marketing';
import { Button } from '@/shared/ui/button';

/**
 * Root 404 — rendered for ANY unmatched top-level URL.
 *
 * Next.js only uses a route-group `not-found.tsx` (e.g. `(public)/not-found`)
 * for `notFound()` calls raised *within* that group's segment tree. An
 * arbitrary unknown top-level path (e.g. `/rota-que-nao-existe`) is matched at
 * the root and renders THIS file, wrapped only by the root `app/layout.tsx`
 * (`<html>`/`<body>`) — the `(public)` layout does NOT apply here. So the
 * marketing chrome (skip link + header + footer) is composed inline, mirroring
 * `(public)/layout.tsx`, to keep the brand frame on the 404.
 *
 * Security / LGPD posture: identical to the public layout. `PublicHeader` is an
 * async Server Component that resolves only a boolean "is authenticated" via
 * `supabase.auth.getUser()` and renders nothing user-specific — no PII reaches
 * this 404. An unknown path is classified `public` by the middleware and passes
 * through; it never redirects to `/login`.
 *
 * Layout: large "404" in `brand/600`, a short message, then a primary CTA
 * ("Criar conta grátis" -> /signup) and a secondary CTA ("Voltar para a
 * homepage" -> /).
 */
export default function NotFound(): React.JSX.Element {
  return (
    <>
      <div className="flex min-h-svh flex-col">
        <SkipLink />
        <PublicHeader />
        <main id={MAIN_CONTENT_ID} className="flex-1">
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
        </main>
        <PublicFooter />
      </div>
    </>
  );
}
