// Minimal shell — full status-driven implementation lands in Section 5 (telepsicologia-patient-join-flow).
'use client';

interface PatientVideoPageProps {
  token: string;
}

/**
 * Client component for the patient video join flow.
 *
 * Receives the validated video join token from the RSC shell (`/v/[token]/page.tsx`).
 * The full implementation (token exchange via Route Handler, status routing,
 * Stream video integration) will be added in Section 5.
 */
export function PatientVideoPage({ token }: PatientVideoPageProps) {
  // Section 5 will use `token` to call the Route Handler and exchange it for
  // room state. Void-reference keeps lint happy until then.
  void token;

  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div
        className="border-border-default h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"
        role="status"
        aria-label="Carregando"
      />
      <p className="text-text-secondary text-[15px]">Carregando...</p>
    </div>
  );
}
