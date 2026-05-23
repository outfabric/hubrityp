'use client';

import { AlertCircle, Chrome, Globe } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BrowserCheckProps {
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
//
// Guards children behind a WebRTC capability check. If the browser does not
// support `navigator.mediaDevices` or `RTCPeerConnection`, the video client
// must never be imported/instantiated — this component renders a fallback
// message with download links instead.
// ---------------------------------------------------------------------------

export function BrowserCheck({ children }: BrowserCheckProps) {
  // Server-side rendering: `navigator` / `window` do not exist.
  // The component is `'use client'` and only runs in the browser, but
  // during SSR the check would throw. Guard with `typeof window`.
  if (typeof window === 'undefined') {
    // During SSR, render nothing — the client hydration will run the check.
    return null;
  }

  const isSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof window.RTCPeerConnection !== 'undefined';

  if (isSupported) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-[480px]">
        <CardHeader className="items-center text-center">
          <div
            className="bg-danger-50 mb-2 flex h-12 w-12 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <AlertCircle className="text-danger-500 h-6 w-6" />
          </div>
          <CardTitle>Navegador incompativel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-text-secondary text-[15px]">
            Seu navegador nao e compativel com videochamadas. Use Chrome, Edge, Firefox ou Safari
            recente.
          </p>

          <div className="flex flex-col items-center gap-3">
            <a
              href="https://www.google.com/chrome/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:text-brand-700 inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
              aria-label="Baixar Google Chrome"
            >
              <Chrome className="h-4 w-4" aria-hidden="true" />
              Baixar Google Chrome
            </a>
            <a
              href="https://www.mozilla.org/pt-BR/firefox/new/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:text-brand-700 inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
              aria-label="Baixar Mozilla Firefox"
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              Baixar Mozilla Firefox
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
