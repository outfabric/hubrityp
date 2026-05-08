import { PatientForm } from '@/modules/patients/components/patient-form';

import { addGuardian, createCouplePatient, createPatient } from '../actions';

/**
 * Server Component page for creating a new patient.
 *
 * Renders h1 title and the PatientForm client component in creation mode.
 * The form calls the `createPatient` Server Action from the parent actions shell.
 * Additional actions for guardians (minors) and couples are passed as well.
 */
export default function NovoPacientePage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <h1
        className="text-text-primary mb-8 text-[28px] leading-[1.25] font-semibold"
        data-testid="new-patient-page-title"
      >
        Novo paciente
      </h1>

      <PatientForm
        createAction={createPatient}
        addGuardianAction={addGuardian}
        createCoupleAction={createCouplePatient}
      />
    </div>
  );
}
