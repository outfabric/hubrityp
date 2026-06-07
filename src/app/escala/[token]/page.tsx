import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

import { getScaleApplicationByToken, ScalePublicForm, scaleByKey } from '@/modules/medical-records';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScalePageProps {
  params: Promise<{ token: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Public patient-facing scale application page.
 *
 * This page is outside the `(app)` route group — no authentication required.
 * The token in the URL is the authorization credential (256 bits of entropy,
 * 64 hex chars). The middleware classifies `/escala` as `public` and passes
 * through.
 *
 * Security controls:
 *   - `getScaleApplicationByToken` uses service-role (bypasses RLS) but
 *     returns ONLY `{ id, scaleKey, isExpired, isCompleted }` — no user_id,
 *     patient_id, names, or scores.
 *   - Not-found and expired tokens render an identical message to prevent
 *     token enumeration attacks.
 *   - No PII is displayed anywhere on the page.
 *
 * States:
 *   - valid (not expired, not completed): renders ScalePublicForm
 *   - expired OR not-found: identical message (no existence leak)
 *   - completed: distinct message (no score shown)
 *
 * Design system alignment:
 *   - bg `background` (from layout)
 *   - Max-width 640px centered (from layout)
 *   - LGPD footer in layout
 *   - Semantic icons per state
 *   - Accessibility: aria-live polite on result region
 */
export default async function ScalePage({ params }: ScalePageProps) {
  const { token } = await params;
  const result = await getScaleApplicationByToken(token);

  // Not found — render identical message to expired (prevents enumeration)
  if (!result.ok) {
    return <ExpiredOrNotFoundState />;
  }

  // Expired — identical message to not-found
  if (result.isExpired) {
    return <ExpiredOrNotFoundState />;
  }

  // Completed — no score shown
  if (result.isCompleted) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        role="status"
        aria-live="polite"
        data-testid="scale-completed"
      >
        <CheckCircle2 className="text-info-500 h-12 w-12" aria-hidden="true" />
        <h2 className="text-text-primary text-[22px] leading-tight font-semibold">
          Este questionario ja foi respondido.
        </h2>
      </div>
    );
  }

  // Valid — resolve scale definition for rendering questions
  const scaleDef = scaleByKey(result.scaleKey);

  // Defensive: if the scale key is unknown (should not happen due to CHECK
  // constraint), render expired state to avoid confusing the patient.
  if (!scaleDef) {
    return <ExpiredOrNotFoundState />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-text-primary text-[22px] leading-tight font-semibold">
          {scaleDef.label}
        </h1>
        <p className="text-text-secondary mt-2 text-[15px]">{scaleDef.description}</p>
        {scaleDef.estimatedMinutes > 0 && (
          <p className="text-text-tertiary mt-1 text-sm">
            <Clock className="mr-1 inline-block h-4 w-4" aria-hidden="true" />
            Tempo estimado: {scaleDef.estimatedMinutes} minutos
          </p>
        )}
      </div>

      <ScalePublicForm questions={scaleDef.questions} token={token} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared state component — expired OR not-found (identical to prevent
// enumeration attacks)
// ---------------------------------------------------------------------------

function ExpiredOrNotFoundState() {
  return (
    <div
      className="flex flex-col items-center gap-3 py-16 text-center"
      role="status"
      aria-live="polite"
      data-testid="scale-expired"
    >
      <AlertCircle className="text-text-tertiary h-12 w-12" aria-hidden="true" />
      <h2 className="text-text-primary text-[22px] leading-tight font-semibold">
        Link indisponível
      </h2>
      <p className="text-text-secondary text-[15px]">
        Este link expirou. Solicite um novo ao seu psicólogo.
      </p>
    </div>
  );
}
