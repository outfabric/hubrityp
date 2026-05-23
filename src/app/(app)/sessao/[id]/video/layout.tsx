import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Video call layout
//
// Renders a minimal chrome (no sidebar, no main header) so the video call
// occupies the full viewport. A ghost back-to-agenda link in a slim top bar
// lets the psychologist navigate away when the call is over.
//
// The standard app shell (header + sidebar) from `(app)/layout.tsx` is still
// in the ancestor tree, but this layout replaces the `<main>` content area
// with its own full-bleed surface. To truly suppress the outer sidebar and
// header, the parent layout would need a slot/context mechanism — for now,
// this layout provides an independent, minimal wrapper that visually replaces
// the standard chrome when the route is active. The outer layout still wraps
// this, but the video call client fills the viewport via CSS.
// ---------------------------------------------------------------------------

export default function VideoCallLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface fixed inset-0 z-50 flex flex-col">
      {/* Minimal top bar */}
      <div className="border-border flex items-center border-b px-4 py-2">
        <Link href="/agenda">
          <Button variant="ghost" size="sm" data-testid="video-back-to-agenda">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Voltar para agenda
          </Button>
        </Link>
      </div>

      {/* Video content area — fills remaining viewport */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
