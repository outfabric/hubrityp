import { notFound } from 'next/navigation';

import { getPatientImpl } from '@/modules/patients';
import { PatientEditForm } from '@/modules/patients/components/patient-edit-form';
import { createServerClient } from '@/shared/supabase/server';

import { updatePatient } from '../actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditPatientPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

export default async function EditPatientPage({ params }: EditPatientPageProps) {
  const { id } = await params;
  const supabase = await createServerClient();

  const result = await getPatientImpl(supabase, id);

  if (!result.ok) {
    notFound();
  }

  const { patient } = result;

  return (
    <div className="mx-auto max-w-[1200px]">
      <h1
        className="text-text-primary mb-8 text-[28px] leading-[1.25] font-semibold"
        data-testid="edit-patient-page-title"
      >
        Editar paciente
      </h1>

      <PatientEditForm patient={patient} updateAction={updatePatient} />
    </div>
  );
}
