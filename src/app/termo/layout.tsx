import type { Metadata } from 'next';

import { Logo } from '@/shared/ui/logo';

export const metadata: Metadata = {
  title: 'Termo de Consentimento — HubrityP',
  description: 'Leia e assine o termo de consentimento informado.',
};

/**
 * Minimal public layout for the consent signing surface (`/termo/:token`).
 *
 * Intentionally outside the `(app)` route group — no sidebar, no navigation,
 * no authentication required. The logo is a plain text mark centered at the
 * top; the footer carries a caption-level line for institutional context.
 *
 * Design system alignment:
 *   - bg `background` (inherited from root layout body)
 *   - Mobile-first padding `space-4`
 *   - Max-width 720px (leitura longa) centered
 */
export default function TermoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      {/* Header — logo centered */}
      <header className="flex items-center justify-center px-4 py-6">
        <Logo variant="lockup-v" className="h-12 w-auto" />
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">{children}</main>

      {/* Footer — minimal caption text */}
      <footer className="px-4 py-6 text-center">
        <p className="text-text-tertiary text-xs font-medium">
          HubrityP — Plataforma para psicólogos
        </p>
      </footer>
    </div>
  );
}
