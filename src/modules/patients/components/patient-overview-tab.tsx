import type { Patient } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Label maps (pt-BR display)
// ---------------------------------------------------------------------------

const PATIENT_TYPE_LABELS: Record<string, string> = {
  individual: 'Adulto',
  child: 'Crianca',
  adolescent: 'Adolescente',
  couple: 'Casal',
  elderly: 'Idoso',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'Masculino',
  female: 'Feminino',
  non_binary: 'Nao-binario',
  other: 'Outro',
  prefer_not_to_say: 'Prefiro nao dizer',
};

const MARITAL_STATUS_LABELS: Record<string, string> = {
  single: 'Solteiro(a)',
  married: 'Casado(a)',
  divorced: 'Divorciado(a)',
  widowed: 'Viuvo(a)',
  civil_union: 'Uniao estavel',
  other: 'Outro',
};

const SOURCE_LABELS: Record<string, string> = {
  indication: 'Indicacao',
  social_media: 'Redes sociais',
  google: 'Google',
  insurance: 'Convenio',
  return: 'Retorno',
  other: 'Outro',
};

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientOverviewTab({ patient }: PatientOverviewTabProps) {
  return (
    <div
      className="border-border bg-surface rounded-xl border p-6 shadow-xs"
      data-testid="patient-overview-card"
    >
      <dl className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        {/* Notes (full width) */}
        {patient.notes && (
          <div className="md:col-span-2" data-testid="patient-field-notes">
            <dt className="text-text-tertiary text-xs font-medium tracking-wide uppercase">
              Anotacoes
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
          label="Genero"
          value={patient.gender ? (GENDER_LABELS[patient.gender] ?? patient.gender) : null}
          testId="patient-field-gender"
        />

        <DataField label="Profissao" value={patient.profession} testId="patient-field-profession" />

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

        <DataField label="Endereco" value={patient.address} testId="patient-field-address" />

        <DataField
          label="Cadastrado em"
          value={patient.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          testId="patient-field-created-at"
        />
      </dl>
    </div>
  );
}
