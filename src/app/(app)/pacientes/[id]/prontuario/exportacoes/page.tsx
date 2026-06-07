import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ExportsList,
  listProntuarioExportsImpl,
  type ExportSummary,
} from '@/modules/medical-records';
import { getPatientImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { getExportSignedUrl } from '../actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportacoesPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

/**
 * Exportacoes page — lists the psychologist's prontuario PDF exports for a
 * specific patient, with real-time status updates via Supabase Realtime.
 *
 * Auth: gated by middleware (/pacientes* -> 'app' class), ownership confirmed
 * by getPatientImpl (RLS + explicit userId filter), and user identity verified
 * via supabase.auth.getUser() to obtain the userId for the Realtime filter.
 */
export default async function ExportacoesPage({ params }: ExportacoesPageProps) {
  const { id: patientId } = await params;
  const supabase = await createServerClient();

  // Verify patient ownership — returns not_found if patient does not belong
  // to the authenticated user.
  const patientResult = await getPatientImpl(supabase, patientId);

  if (!patientResult.ok) {
    notFound();
  }

  // Obtain user id for the Realtime channel filter. The page is already
  // auth-gated by middleware; calling getUser() here is to read the id, not
  // for authorization (which is handled by listProntuarioExportsImpl and RLS).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  // Fetch initial exports list server-side
  const exportsResult = await listProntuarioExportsImpl(supabase, { patientId });
  const exports: ExportSummary[] = exportsResult.ok ? exportsResult.exports : [];

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href={`/pacientes/${patientId}/prontuario`}>
          <Button variant="ghost" size="sm" data-testid="exportacoes-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar ao prontuário
          </Button>
        </Link>
      </div>

      {/* Page title */}
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="exportacoes-page-title"
        >
          Exportações
        </h1>
        <p className="text-text-secondary mt-1 text-sm">
          Histórico de exportações do prontuário em PDF.
        </p>
      </div>

      {/* Client component with Realtime subscription */}
      <ExportsList
        initial={exports}
        patientId={patientId}
        userId={user.id}
        getExportSignedUrl={getExportSignedUrl}
      />
    </div>
  );
}
