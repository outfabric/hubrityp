import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Confirmar presenca — HubrityP',
  description: 'Confirme ou cancele sua sessao agendada.',
};

/**
 * Minimal public layout for the session confirmation surface (`/confirmar-sessao/:token`).
 *
 * Intentionally outside the `(app)` route group — no sidebar, no navigation,
 * no authentication required. The logo is a plain text mark centered at the
 * top; the footer carries a caption-level line for institutional context.
 *
 * Mirrors the pattern from `src/app/termo/layout.tsx`.
 *
 * Design system alignment:
 *   - bg `background` (inherited from root layout body)
 *   - Mobile-first padding `space-4` / desktop `space-8`
 *   - Max-width 480px centered (confirmation page is narrower than consent)
 */
export default function ConfirmarSessaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      {/* Header — logo centered */}
      <header className="flex items-center justify-center px-4 py-6 md:px-8">
        <span className="text-text-primary text-lg font-semibold">HubrityP</span>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-[480px] flex-1 px-4 pb-8 md:px-8">{children}</main>

      {/* Footer — minimal caption text */}
      <footer className="px-4 py-6 text-center md:px-8">
        <p className="text-text-tertiary text-xs font-medium">
          HubrityP — Plataforma para psicologos
        </p>
      </footer>
    </div>
  );
}
