import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPatientImpl, getPatientPhotoUrlImpl } from '@/modules/patients';
import { PatientDetailHeader } from '@/modules/patients/components/patient-detail-header';
import { PatientOverviewTab } from '@/modules/patients/components/patient-overview-tab';
import { PatientTabs } from '@/modules/patients/components/patient-tabs';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { archivePatient, deletePatient, unarchivePatient } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PatientDetailPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

export default async function PatientDetailPage({ params }: PatientDetailPageProps) {
  const { id } = await params;
  const supabase = await createServerClient();

  // Fetch patient and photo URL in parallel
  const [patientResult, photoResult] = await Promise.all([
    getPatientImpl(supabase, id),
    getPatientPhotoUrlImpl(supabase, id),
  ]);

  if (!patientResult.ok) {
    notFound();
  }

  const { patient } = patientResult;
  const photoUrl = photoResult.ok ? photoResult.signedUrl : undefined;

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href="/pacientes">
          <Button variant="ghost" size="sm" data-testid="patient-detail-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar
          </Button>
        </Link>
      </div>

      {/* Header */}
      <PatientDetailHeader
        patient={patient}
        photoUrl={photoUrl}
        archiveAction={archivePatient}
        unarchiveAction={unarchivePatient}
        deleteAction={deletePatient}
      />

      {/* Tabs */}
      <div className="mt-8">
        <PatientTabs overviewContent={<PatientOverviewTab patient={patient} />} />
      </div>
    </div>
  );
}
