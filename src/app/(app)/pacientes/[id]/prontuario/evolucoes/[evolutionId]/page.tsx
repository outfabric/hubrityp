import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getEvolutionDetailImpl, listEvolutionVersionsImpl } from '@/modules/medical-records';
import { getPatientImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { EvolutionDetailView } from './_components/evolution-detail-view';
import { updateEvolution } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvolutionDetailPageProps {
  params: Promise<{ id: string; evolutionId: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Evolution detail page — displays a single evolution for viewing/editing.
 *
 * Fetches evolution detail (writes audit 'evolution.read' server-side) and
 * version history in parallel. Pre-fills the EvolutionEditor and shows the
 * appropriate action button based on the 30-day immutability window.
 *
 * Auth: gated by middleware (/pacientes* → 'app' class), ownership confirmed
 * by both getPatientImpl and getEvolutionDetailImpl (which validates
 * user_id ownership + RLS).
 */
export default async function EvolutionDetailPage({ params }: EvolutionDetailPageProps) {
  const { id: patientId, evolutionId } = await params;
  const supabase = await createServerClient();

  // Confirm patient ownership (defense-in-depth — the evolution query also
  // checks userId, but we verify the patient belongs to this psychologist too)
  const patientResult = await getPatientImpl(supabase, patientId);

  if (!patientResult.ok) {
    notFound();
  }

  // Fetch evolution detail + versions in parallel
  const [evolutionResult, versionsResult] = await Promise.all([
    getEvolutionDetailImpl(supabase, { evolutionId }),
    listEvolutionVersionsImpl(supabase, { evolutionId }),
  ]);

  if (!evolutionResult.ok) {
    notFound();
  }

  const evolution = evolutionResult.evolution;
  const versions = versionsResult.ok ? versionsResult.versions : [];

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href={`/pacientes/${patientId}/prontuario`}>
          <Button variant="ghost" size="sm" data-testid="evolution-detail-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar ao prontuário
          </Button>
        </Link>
      </div>

      {/* Page title */}
      <h1
        className="text-text-primary mb-6 text-[28px] leading-[1.25] font-semibold"
        data-testid="evolution-detail-page-title"
      >
        Evolução
      </h1>

      {/* Detail view with editor and version history */}
      <EvolutionDetailView
        evolution={evolution}
        versions={versions}
        updateAction={updateEvolution}
      />
    </div>
  );
}
