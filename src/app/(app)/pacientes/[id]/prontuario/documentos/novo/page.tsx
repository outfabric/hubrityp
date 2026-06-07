import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { createDocument } from '@/app/(app)/pacientes/[id]/prontuario/actions';
import { DocumentTypeSelector } from '@/modules/medical-records/components/document-type-selector';
import { getPatientImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewDocumentPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page (Server Component)
// ---------------------------------------------------------------------------

/**
 * Document type selector page.
 *
 * Auth: gated by middleware (classifyPath treats /pacientes* as 'app'),
 * ownership confirmed by getPatientImpl (RLS + explicit userId filter).
 */
export default async function NewDocumentPage({ params }: NewDocumentPageProps) {
  const { id: patientId } = await params;
  const supabase = await createServerClient();

  // Confirm patient ownership — returns not_found if patient does not belong
  // to this user (defense-in-depth: middleware + RLS + explicit check).
  const patientResult = await getPatientImpl(supabase, patientId);

  if (!patientResult.ok) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-[720px]">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href={`/pacientes/${patientId}/prontuario`}>
          <Button variant="ghost" size="sm" data-testid="new-document-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar ao prontuário
          </Button>
        </Link>
      </div>

      <DocumentTypeSelector patientId={patientId} createDocument={createDocument} />
    </div>
  );
}
