import { Logo } from '@/shared/ui/logo';

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      {/* Visually-hidden h1 keeps the document outline intact; the Logo is an
          SVG `role="img"` (aria-label "Hubrity"), not a heading. */}
      <h1 className="sr-only">Hubrity</h1>
      <Logo variant="lockup-v" className="h-24 w-auto" />
    </main>
  );
}
