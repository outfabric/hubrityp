'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { useAiTranscriptionRealtime } from '../hooks/use-ai-transcription-realtime';

// ---------------------------------------------------------------------------
// Query client factory
//
// There is no global QueryClientProvider in this app — each client island
// owns its cache (same pattern as AudioUploadButton / AiConsentPanel). The
// realtime hook invalidates `['ai-transcriptions', ...]` keys on this client;
// any future client consumer of those keys mounted inside this boundary will
// observe the invalidation. React's useState initialiser runs once per mount.
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

interface AiRealtimeBoundaryProps {
  /**
   * Authenticated user id, resolved server-side in the layout and passed down.
   * Never client-controlled. When absent the hook does not subscribe.
   */
  userId: string | null;
}

/**
 * Thin client boundary that keeps `(app)/layout.tsx` a Server Component while
 * still mounting the realtime subscription hook. Renders nothing visible — the
 * notifications surface through the global Sonner `<Toaster>` (root layout).
 */
export function AiRealtimeBoundary({ userId }: AiRealtimeBoundaryProps) {
  const [client] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={client}>
      <RealtimeSubscriber userId={userId} />
    </QueryClientProvider>
  );
}

/**
 * Inner component so `useAiTranscriptionRealtime` runs *inside* the
 * QueryClientProvider (a hook cannot call `useQueryClient` in the same
 * component that creates the provider).
 */
function RealtimeSubscriber({ userId }: AiRealtimeBoundaryProps) {
  useAiTranscriptionRealtime(userId);
  return null;
}
