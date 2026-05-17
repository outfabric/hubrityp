import { notFound } from 'next/navigation';

import { getEvolutionsByPatientImpl, type EvolutionSummary } from '@/modules/medical-records';
import { getPatientImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';

import { EvolutionsList } from './_components/evolutions-list';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvolucoesPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Evolucoes sub-route — renders the chronological list of evolutions.
 *
 * This page can be navigated to directly (e.g., from a link); the prontuario
 * parent page renders the same content inline via ProntuarioTabs. This route
 * exists for deep-linking and future tab-based routing.
 *
 * Auth: gated by middleware (/pacientes* → 'app' class), ownership confirmed
 * by getPatientImpl (RLS + explicit userId).
 */
export default async function EvolucoesPage({ params }: EvolucoesPageProps) {
  const { id: patientId } = await params;
  const supabase = await createServerClient();

  // Confirm patient ownership
  const patientResult = await getPatientImpl(supabase, patientId);

  if (!patientResult.ok) {
    notFound();
  }

  // Fetch evolutions
  const evolutionsResult = await getEvolutionsByPatientImpl(supabase, {
    patientId,
    limit: 20,
  });

  const evolutions: EvolutionSummary[] = evolutionsResult.ok ? evolutionsResult.evolutions : [];
  const nextCursor: string | null = evolutionsResult.ok ? evolutionsResult.nextCursor : null;

  return (
    <div className="mx-auto max-w-[1200px]">
      <EvolutionsList
        patientId={patientId}
        initialEvolutions={evolutions}
        initialNextCursor={nextCursor}
      />
    </div>
  );
}
