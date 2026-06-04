import { Suspense } from 'react';

import { getNpsHasResponded } from '@/modules/nps';
import { createServerClient } from '@/shared/supabase/server';

import { submitNpsFeedbackAction } from './actions';
import { FeedbackFormClient } from './feedback-form-client';

// ---------------------------------------------------------------------------
// Inner async component that resolves whether the user already responded
// ---------------------------------------------------------------------------

async function FeedbackServer() {
  const supabase = await createServerClient();
  const alreadyResponded = await getNpsHasResponded(supabase);

  return (
    <FeedbackFormClient onSubmit={submitNpsFeedbackAction} alreadyResponded={alreadyResponded} />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function FeedbackPage() {
  return (
    <>
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="feedback-page-title"
        >
          Feedback
        </h1>
        <p className="text-text-secondary mt-1 text-[15px]">
          Conte como tem sido sua experiência com o sistema.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <FeedbackServer />
      </Suspense>
    </>
  );
}
