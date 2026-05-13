'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

import type { Patient } from '@/shared/db/schema/patients/tables';

import { PatientForm } from './patient-form';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientEditFormProps {
  patient: Patient;
  updateAction: (
    patientId: string,
    input: unknown,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    message?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PatientEditForm — thin client wrapper that passes `PatientForm` in edit mode
 * and fires a Sonner success toast on successful update.
 */
export function PatientEditForm({ patient, updateAction }: PatientEditFormProps) {
  const handleSuccess = useCallback(() => {
    toast.success('Paciente atualizado');
  }, []);

  return (
    <PatientForm
      mode="edit"
      patient={{
        id: patient.id,
        fullName: patient.fullName,
        patientType: patient.patientType,
        birthDate: patient.birthDate,
        approximateAge: patient.approximateAge,
        phone: patient.phone,
        gender: patient.gender,
        email: patient.email,
        cpf: patient.cpf,
        address: patient.address,
        profession: patient.profession,
        maritalStatus: patient.maritalStatus,
        source: patient.source,
        tags: patient.tags,
        notes: patient.notes,
        whatsappOptOut: patient.whatsappOptOut,
        reminderPhone: patient.reminderPhone,
      }}
      updateAction={updateAction}
      onSuccess={handleSuccess}
    />
  );
}
