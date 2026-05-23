'use client';

import { AlertCircle, Chrome, Globe } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

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
//
// Renders children optimistically during SSR (assume supported) to avoid
// hydration mismatch. A useEffect runs the real check client-side and swaps
// to the fallback only when the browser is confirmed unsupported.
// ---------------------------------------------------------------------------

export function BrowserCheck({ children }: BrowserCheckProps) {
  // Optimistic default: assume supported so SSR and initial client render agree.
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const isSupported =
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices !== 'undefined' &&
      typeof window.RTCPeerConnection !== 'undefined';

    if (!isSupported) {
      // Deferred to avoid synchronous setState inside effect (React Compiler rule)
      const id = requestAnimationFrame(() => {
        setSupported(false);
      });
      return () => cancelAnimationFrame(id);
    }
  }, []);

  if (supported) {
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
          <CardTitle>
            <h1>Navegador incompatível</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-text-secondary text-[15px]">
            Seu navegador não é compatível com videochamadas. Use Chrome, Edge, Firefox ou Safari
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
