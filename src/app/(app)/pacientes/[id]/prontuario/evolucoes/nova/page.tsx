import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPatientImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { NewEvolutionForm } from './_components/new-evolution-form';
import { createEvolution } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NovaEvolucaoPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sessionId?: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * New evolution creation page.
 *
 * Renders TemplateSelector + EvolutionEditor for creating a new clinical
 * evolution note. Accepts optional ?sessionId query param to link the
 * evolution to a specific clinical session on submission.
 *
 * Auth: gated by middleware (/pacientes* → 'app' class), ownership confirmed
 * by getPatientImpl (RLS + explicit userId filter).
 */
export default async function NovaEvolucaoPage({ params, searchParams }: NovaEvolucaoPageProps) {
  const { id: patientId } = await params;
  const { sessionId } = await searchParams;
  const supabase = await createServerClient();

  // Confirm patient ownership
  const patientResult = await getPatientImpl(supabase, patientId);

  if (!patientResult.ok) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href={`/pacientes/${patientId}/prontuario`}>
          <Button variant="ghost" size="sm" data-testid="nova-evolucao-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar ao prontuario
          </Button>
        </Link>
      </div>

      {/* Page title */}
      <h1
        className="text-text-primary mb-6 text-[28px] leading-[1.25] font-semibold"
        data-testid="nova-evolucao-page-title"
      >
        Nova evolucao
      </h1>

      {/* Form: TemplateSelector + EvolutionEditor */}
      <NewEvolutionForm
        patientId={patientId}
        sessionId={sessionId}
        createAction={createEvolution}
      />
    </div>
  );
}
