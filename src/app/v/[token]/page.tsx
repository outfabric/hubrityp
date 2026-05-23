import { notFound } from 'next/navigation';

import { PatientVideoPage } from '@/modules/telepsicologia';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VideoJoinPageProps {
  params: Promise<{ token: string }>;
}

// Token format: 64-character lowercase hexadecimal (256 bits of entropy)
const TOKEN_RE = /^[a-f0-9]{64}$/;

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Public patient video join page — thin RSC shell.
 *
 * This page is outside the `(app)` route group — no authentication required.
 * The video join token in the URL is the authorization credential (256 bits of
 * entropy). The middleware classifies `/v` as `public` and passes through.
 *
 * Responsibilities:
 *   1. Extract and validate the token format (64-char hex).
 *   2. Delegate to the `PatientVideoPage` client component, which calls the
 *      Route Handler to exchange the token for session/room state.
 *
 * No data loading happens here — the client component handles fetching via the
 * Route Handler so the page can react to real-time status changes.
 */
export default async function VideoJoinPage({ params }: VideoJoinPageProps) {
  const { token } = await params;

  if (!TOKEN_RE.test(token)) {
    notFound();
  }

  return <PatientVideoPage token={token} />;
}
