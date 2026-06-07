import { ArrowLeft, History } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  checkActiveConsentForPatientImpl,
  ExportPanel,
  getEvolutionsByPatientImpl,
  logProntuarioAccessImpl,
  type EvolutionSummary,
} from '@/modules/medical-records';
import { ProntuarioTabs } from '@/modules/medical-records/components/prontuario-tabs';
import { getPatientImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { requestProntuarioExport } from './actions';
import { EvolutionsList } from './evolucoes/_components/evolutions-list';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProntuarioPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Prontuario landing page for a patient.
 *
 * Auth: gated by middleware (classifyPath treats /pacientes* as 'app'),
 * ownership confirmed by getPatientImpl (RLS + explicit userId filter),
 * and access logged to audit_log.
 */
export default async function ProntuarioPage({ params }: ProntuarioPageProps) {
  const { id: patientId } = await params;
  const supabase = await createServerClient();

  // Confirm ownership — returns not_found if patient does not belong to this user
  const patientResult = await getPatientImpl(supabase, patientId);

  if (!patientResult.ok) {
    notFound();
  }

  // Log prontuario access (fire-and-forget — does not block render)
  void logProntuarioAccessImpl(supabase, {
    action: 'prontuario.read',
    resourceType: 'patient',
    resourceId: patientId,
  });

  // Fetch evolutions and consent status in parallel — independent queries
  const [evolutionsResult, hasActiveConsent] = await Promise.all([
    getEvolutionsByPatientImpl(supabase, { patientId, limit: 20 }),
    // Use the consent_terms table (same source as the server action's
    // checkActiveConsent) so the UI gate and server-side gate never disagree.
    checkActiveConsentForPatientImpl(supabase, patientId),
  ]);

  const evolutions: EvolutionSummary[] = evolutionsResult.ok ? evolutionsResult.evolutions : [];
  const nextCursor: string | null = evolutionsResult.ok ? evolutionsResult.nextCursor : null;

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href={`/pacientes/${patientId}`}>
          <Button variant="ghost" size="sm" data-testid="prontuario-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar
          </Button>
        </Link>
      </div>

      {/* Page title + export actions */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="prontuario-page-title"
        >
          Prontuário
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/pacientes/${patientId}/prontuario/exportacoes`}>
            <Button variant="ghost" size="sm" data-testid="prontuario-exports-link">
              <History className="h-4 w-4" aria-hidden="true" />
              Ver exportações
            </Button>
          </Link>
          <ExportPanel patientId={patientId} requestExport={requestProntuarioExport} />
        </div>
      </div>

      {/* Tabs shell — Evolucoes tab active by default */}
      <ProntuarioTabs patientId={patientId} hasActiveConsent={hasActiveConsent}>
        <EvolutionsList
          patientId={patientId}
          initialEvolutions={evolutions}
          initialNextCursor={nextCursor}
        />
      </ProntuarioTabs>
    </div>
  );
}
