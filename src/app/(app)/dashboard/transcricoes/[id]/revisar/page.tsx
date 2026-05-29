import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getTranscriptionForReviewImpl } from '@/modules/ai-transcription';
import { DraftWarningBanner } from '@/modules/ai-transcription/components/draft-warning-banner';
import { RiskAlertBanner } from '@/modules/ai-transcription/components/risk-alert-banner';
import { TranscriptionStatusBadge } from '@/modules/ai-transcription/components/transcription-status-badge';
import { createServerClient } from '@/shared/supabase/server';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

import { TranscriptionReviewForm } from './_components/transcription-review-form';
import {
  discardTranscription,
  saveTranscriptionToProntuario,
  updateTranscriptionDraft,
} from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevisarPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// pt-BR error-code labels for the failed/cancelled state
// ---------------------------------------------------------------------------

const ERROR_CODE_LABELS: Record<string, string> = {
  gemini_429: 'O serviço de IA está sobrecarregado no momento.',
  gemini_error: 'Houve uma falha ao gerar a nota com a IA.',
  transcription_failed: 'Não foi possível transcrever o áudio.',
  audio_invalid: 'O arquivo de áudio enviado não pôde ser processado.',
  consent_revoked: 'O consentimento de IA foi revogado durante o processamento.',
};

function errorReason(errorCode: string | null): string {
  if (!errorCode) {
    return 'Ocorreu um erro durante o processamento desta transcrição.';
  }
  return (
    ERROR_CODE_LABELS[errorCode] ?? 'Ocorreu um erro durante o processamento desta transcrição.'
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSessionDate(sessionDate: Date | null): string | null {
  if (!sessionDate) {
    return null;
  }
  // pt-BR locale; the value is a UTC timestamp rendered for display only.
  return format(sessionDate, "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
}

// ---------------------------------------------------------------------------
// Page (Server Component)
// ---------------------------------------------------------------------------

/**
 * AI-transcription review page.
 *
 * Auth: gated by middleware — `/dashboard*` is the `'app'` (authenticated)
 * class (see `src/middleware.ts:classifyPath`), so anonymous requests are
 * redirected to `/login` before this code runs. Defense-in-depth: the data
 * read uses an RLS-scoped Supabase client carrying the caller's session, and
 * `getTranscriptionForReviewImpl` re-authenticates via `getUser()` and scopes
 * the query to `user_id = caller`. A cross-tenant `id` resolves to NOT_FOUND
 * (no data, no patient name leaked).
 */
export default async function RevisarTranscricaoPage({ params }: RevisarPageProps) {
  const { id } = await params;

  const supabase = await createServerClient();
  const result = await getTranscriptionForReviewImpl(supabase, { transcriptionId: id });

  if (!result.ok) {
    // UNAUTHORIZED should never reach here (middleware gates it), but if a
    // future refactor bypasses the gate we mirror the middleware target rather
    // than leaking a partial UI.
    if (result.code === 'UNAUTHORIZED') {
      redirect('/login');
    }

    // NOT_FOUND / INVALID_INPUT → neutral not-found state. We deliberately do
    // NOT reveal whether the row exists for another tenant (IDOR answer).
    return (
      <div className="mx-auto max-w-[720px] px-4 py-8 md:px-8">
        <Alert variant="danger" data-testid="transcription-not-found">
          <AlertTitle>Transcrição não encontrada</AlertTitle>
          <AlertDescription>
            Esta transcrição não existe ou você não tem acesso a ela.
          </AlertDescription>
        </Alert>
        <div className="mt-6">
          <Button asChild variant="secondary">
            <Link href="/dashboard/transcricoes">Voltar para transcrições</Link>
          </Button>
        </div>
      </div>
    );
  }

  const sessionDateLabel = formatSessionDate(result.sessionDate);

  // -------------------------------------------------------------------------
  // Failed / cancelled branch — no form, just status + reason (+ retry).
  // -------------------------------------------------------------------------
  if (result.status === 'failed' || result.status === 'cancelled') {
    const isFailed = result.status === 'failed';

    return (
      <div className="mx-auto max-w-[720px] px-4 py-8 md:px-8">
        <header className="mb-8 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-text-primary text-[28px] leading-[1.25] font-semibold">
              Revisar nota IA
            </h1>
            <TranscriptionStatusBadge status={result.status} />
          </div>
          <p className="text-text-secondary text-[13px]">
            {result.patientFirstName}
            {sessionDateLabel ? ` · ${sessionDateLabel}` : ''}
          </p>
        </header>

        <Alert variant={isFailed ? 'danger' : 'warning'} data-testid="transcription-error-state">
          <AlertTitle>{isFailed ? 'A geração da nota falhou' : 'Transcrição cancelada'}</AlertTitle>
          <AlertDescription>{errorReason(result.errorCode)}</AlertDescription>
        </Alert>

        <div className="mt-6 flex flex-wrap gap-3">
          {isFailed && (
            // No retry Server Action exists yet (Inngest re-dispatch is out of
            // this section's scope). Per the spec's "(or invokes a retry Server
            // Action)" alternative, we route the user back to the patient's
            // upload flow so they can re-send the audio. The patient page is the
            // canonical entry point for `ai-transcription/audio.uploaded`.
            <Button asChild data-testid="retry-transcription-btn">
              <Link href={`/pacientes/${result.patientId}/prontuario`}>Tentar de novo</Link>
            </Button>
          )}
          <Button asChild variant="secondary">
            <Link href="/dashboard/transcricoes">Voltar para transcrições</Link>
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Reviewable branch — render banners + form.
  // -------------------------------------------------------------------------
  // The real prontuário route is `/pacientes/[id]/prontuario/...` (the
  // `/dashboard/pacientes/...` path referenced in the spec does not exist in
  // the route tree). We build the working paths so both the discard redirect
  // (new-evolution editor) and the post-save redirect (created evolution) land
  // on real pages.
  const prontuarioHref = `/pacientes/${result.patientId}/prontuario`;
  const sessionQuery = result.sessionId ? `?sessionId=${encodeURIComponent(result.sessionId)}` : '';
  const discardRedirectHref = `${prontuarioHref}/evolucoes/nova${sessionQuery}`;

  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-text-primary text-[28px] leading-[1.25] font-semibold">
            Revisar nota IA
          </h1>
          <TranscriptionStatusBadge status={result.status} />
        </div>
        <p className="text-text-secondary text-[13px]">
          {result.patientFirstName}
          {sessionDateLabel ? ` · ${sessionDateLabel}` : ''}
        </p>
      </header>

      {result.status === 'ready' && <DraftWarningBanner className="mb-6" />}

      {result.riskAlerts.length > 0 && (
        <RiskAlertBanner riskAlerts={result.riskAlerts} className="mb-6" />
      )}

      <TranscriptionReviewForm
        transcriptionId={result.transcriptionId}
        initialNote={result.generatedNote}
        discardRedirectHref={discardRedirectHref}
        prontuarioHref={prontuarioHref}
        updateDraftAction={updateTranscriptionDraft}
        saveToProntuarioAction={saveTranscriptionToProntuario}
        discardAction={discardTranscription}
      />
    </div>
  );
}
