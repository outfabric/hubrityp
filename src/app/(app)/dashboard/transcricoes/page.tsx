import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { listTranscriptionsForReviewImpl } from '@/modules/ai-transcription';
import { TranscriptionsEmptyState } from '@/modules/ai-transcription/components/transcriptions-empty-state';
import { TranscriptionsTabs } from '@/modules/ai-transcription/components/transcriptions-tabs';
import { createServerClient } from '@/shared/supabase/server';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function TranscriptionListServer() {
  const supabase = await createServerClient();
  const result = await listTranscriptionsForReviewImpl(supabase);

  // Defense-in-depth: middleware (section 3) is the authoritative gate that
  // redirects anonymous requests to /login, so an UNAUTHORIZED here should
  // never happen in practice. We mirror the middleware target rather than
  // leaking a partial UI if a future refactor bypasses the gate.
  if (!result.ok) {
    redirect('/login');
  }

  const isEmpty =
    result.pending.length === 0 && result.reviewed.length === 0 && result.failed.length === 0;

  if (isEmpty) {
    return <TranscriptionsEmptyState />;
  }

  return (
    <TranscriptionsTabs
      buckets={{
        pending: result.pending,
        reviewed: result.reviewed,
        failed: result.failed,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function TranscricoesPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="transcricoes-page-title"
        >
          Transcrições
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <TranscriptionListServer />
      </Suspense>
    </div>
  );
}
