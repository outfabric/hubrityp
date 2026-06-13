import type { Metadata } from 'next';

import { Logo } from '@/shared/ui/logo';

export const metadata: Metadata = {
  title: 'Questionário — Hubrity',
  description: 'Responda ao questionário enviado pelo seu psicólogo.',
};

/**
 * Minimal public layout for the patient-facing scale surface (`/escala/:token`).
 *
 * Intentionally outside the `(app)` route group — no sidebar, no navigation,
 * no authentication required. The token in the URL is the authorization
 * credential (256 bits of entropy). The middleware classifies `/escala` as
 * `public` and passes through.
 *
 * Same pattern as `src/app/confirmar-sessao/layout.tsx` and
 * `src/app/termo/layout.tsx`.
 *
 * Design system alignment:
 *   - bg `background` (inherited from root layout body)
 *   - Mobile-first padding `space-4` / desktop `space-8`
 *   - Max-width 640px centered (wider than confirmation, narrower than consent)
 *   - LGPD footer text for data protection notice
 */
export default function EscalaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      {/* Header — logo centered */}
      <header className="flex items-center justify-center px-4 py-6 md:px-8">
        <Logo variant="lockup-v" className="h-12 w-auto" />
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-[640px] flex-1 px-4 pb-8 md:px-8">{children}</main>

      {/* Footer — LGPD notice */}
      <footer className="px-4 py-6 text-center md:px-8">
        <p className="text-text-tertiary text-xs font-medium">
          Suas respostas são protegidas pela LGPD e serão acessíveis apenas ao seu psicólogo.
        </p>
        <p className="text-text-tertiary mt-1 text-xs font-medium">
          HubrityP — Plataforma para psicólogos
        </p>
      </footer>
    </div>
  );
}
