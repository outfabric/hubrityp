import type { Patient, PatientGuardian } from '@/shared/db/schema/patients/tables';

import { formatAddress } from '../lib/format-address';
import {
  GENDER_LABELS,
  MARITAL_STATUS_LABELS,
  PATIENT_TYPE_LABELS,
  SOURCE_LABELS,
} from '../lib/patient-types';
import type { AddGuardianResult } from '../server/add-guardian';
import type { ListGuardiansResult } from '../server/list-guardians';
import type { RemoveGuardianResult } from '../server/remove-guardian';
import type { UnlinkCoupleResult } from '../server/unlink-couple';
import type { UpdateGuardianResult } from '../server/update-guardian';

import { PatientCoupleSection } from './patient-couple-section';
import { PatientGuardiansSection } from './patient-guardians-section';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Masks a CPF showing only the last 2 digits: "***.***.***-XX"
 */
function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length < 2) return '***.***.***-**';
  const lastTwo = digits.slice(-2);
  return `***.***.***-${lastTwo}`;
}

/**
 * Formats birth date as DD/MM/YYYY and calculates age.
 */
function formatBirthDateWithAge(birthDate: Date | null, approximateAge: string | null): string {
  if (!birthDate) {
    if (approximateAge) return `~${approximateAge} anos`;
    return '-';
  }
  const formatted = birthDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return `${formatted} (${age} anos)`;
}

// ---------------------------------------------------------------------------
// DataField — reusable field renderer
// ---------------------------------------------------------------------------

interface DataFieldProps {
  label: string;
  value: string | null | undefined;
  testId?: string;
}

function DataField({ label, value, testId }: DataFieldProps) {
  return (
    <div data-testid={testId}>
      <dt className="text-text-tertiary text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-text-primary mt-1 text-[15px]">{value || '-'}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientOverviewTabProps {
  patient: Patient;
  /** Pre-fetched guardians (only for minor patients). */
  initialGuardians?: PatientGuardian[];
  /** Server Action to list guardians for the patient. */
  listGuardiansAction?: (patientId: string) => Promise<ListGuardiansResult>;
  /** Server Action to add a guardian. */
  addGuardianAction?: (patientId: string, input: unknown) => Promise<AddGuardianResult>;
  /** Server Action to update a guardian. */
  updateGuardianAction?: (guardianId: string, input: unknown) => Promise<UpdateGuardianResult>;
  /** Server Action to remove a guardian. */
  removeGuardianAction?: (guardianId: string) => Promise<RemoveGuardianResult>;
  /** Pre-fetched couple partner (only for couple patients). */
  couplePartner?: Patient;
  /** Server Action to unlink the couple. */
  unlinkCoupleAction?: (patientId: string) => Promise<UnlinkCoupleResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientOverviewTab({
  patient,
  initialGuardians,
  listGuardiansAction,
  addGuardianAction,
  updateGuardianAction,
  removeGuardianAction,
  couplePartner,
  unlinkCoupleAction,
}: PatientOverviewTabProps) {
  const isMinor = patient.patientType === 'child' || patient.patientType === 'adolescent';
  const hasGuardianActions =
    initialGuardians &&
    listGuardiansAction &&
    addGuardianAction &&
    updateGuardianAction &&
    removeGuardianAction;
  const isCouple = patient.patientType === 'couple' && couplePartner && unlinkCoupleAction;

  return (
    <div className="space-y-6">
      <div
        className="border-border bg-surface rounded-xl border p-6 shadow-xs"
        data-testid="patient-overview-card"
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          {/* Notes (full width) */}
          {patient.notes && (
            <div className="md:col-span-2" data-testid="patient-field-notes">
              <dt className="text-text-tertiary text-xs font-medium tracking-wide uppercase">
                Anotações
              </dt>
              <dd className="text-text-primary mt-1 max-w-[720px] text-[15px] whitespace-pre-wrap">
                {patient.notes}
              </dd>
            </div>
          )}

          <DataField
            label="Tipo de paciente"
            value={PATIENT_TYPE_LABELS[patient.patientType] ?? patient.patientType}
            testId="patient-field-patient-type"
          />

          <DataField
            label="Data de nascimento"
            value={formatBirthDateWithAge(patient.birthDate, patient.approximateAge)}
            testId="patient-field-birth-date"
          />

          <DataField
            label="Gênero"
            value={patient.gender ? (GENDER_LABELS[patient.gender] ?? patient.gender) : null}
            testId="patient-field-gender"
          />

          <DataField
            label="Profissão"
            value={patient.profession}
            testId="patient-field-profession"
          />

          <DataField
            label="Estado civil"
            value={
              patient.maritalStatus
                ? (MARITAL_STATUS_LABELS[patient.maritalStatus] ?? patient.maritalStatus)
                : null
            }
            testId="patient-field-marital-status"
          />

          <DataField
            label="Como chegou"
            value={patient.source ? (SOURCE_LABELS[patient.source] ?? patient.source) : null}
            testId="patient-field-source"
          />

          <DataField label="Telefone" value={patient.phone} testId="patient-field-phone" />

          <DataField label="E-mail" value={patient.email} testId="patient-field-email" />

          <DataField
            label="CPF"
            value={patient.cpf ? maskCpf(patient.cpf) : null}
            testId="patient-field-cpf"
          />

          <DataField
            label="Endereço"
            value={formatAddress(patient.address)}
            testId="patient-field-address"
          />

          <DataField
            label="Cadastrado em"
            value={patient.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
            testId="patient-field-created-at"
          />
        </dl>
      </div>

      {isCouple && (
        <PatientCoupleSection
          patientId={patient.id}
          partner={couplePartner}
          unlinkCoupleAction={unlinkCoupleAction}
        />
      )}

      {isMinor && hasGuardianActions && (
        <PatientGuardiansSection
          patientId={patient.id}
          patientType={patient.patientType}
          initialGuardians={initialGuardians}
          listGuardiansAction={listGuardiansAction}
          addGuardianAction={addGuardianAction}
          updateGuardianAction={updateGuardianAction}
          removeGuardianAction={removeGuardianAction}
        />
      )}
    </div>
  );
}
