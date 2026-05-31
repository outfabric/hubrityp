'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Lock, Upload, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useId, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  CsvColumnMapper,
  type ColumnMapping,
} from '@/modules/patients/components/csv-column-mapper';
import { CsvPreviewTable, type PreviewRow } from '@/modules/patients/components/csv-preview-table';
import { CsvUpload, type CsvParseResult } from '@/modules/patients/components/csv-upload';
import {
  detectColumnMapping,
  type PatientField,
  PATIENT_FIELDS,
} from '@/modules/patients/lib/csv-column-mapping';
import { formatPhone, isValidBrazilianPhone } from '@/modules/patients/lib/patient-validators';
import { type MappedCsvRow, validateCsvRow } from '@/modules/patients/lib/validate-csv-row';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Action result shapes (mirror the module impls' sanitized results)
// ---------------------------------------------------------------------------

export type ImportPatientsStepResult =
  | { ok: true; importedCount: number }
  | { ok: false; error: 'unauthenticated' | 'consent_required' | 'validation_error' | 'db_error' };

export type QuickAddPatientStepResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'unauthenticated'
        | 'duplicate_phone'
        | 'duplicate_email'
        | 'unknown'
        | 'invalid_input';
      fieldErrors?: Record<string, string[]>;
    };

export type SkipPatientsStepResult = { ok: true } | { ok: false };

// CSV rows handed to the import action. The shape matches the patients module's
// `CsvPatientRow`; we keep it local to avoid importing a server-only type into
// this client leaf.
export interface OnboardingCsvPatientRow {
  fullName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  tags?: string[];
  notes: string | null;
}

export interface StepPatientsProps {
  /**
   * Whether the psychologist has accepted the LGPD sensitive-data consent term
   * (`profiles.sensitive_data_consent_at IS NOT NULL`). When `false`, the CSV
   * upload option is DISABLED and points the user to "Configurações >
   * Privacidade" to accept the term (RN-11.03). The server gate enforces this
   * regardless of the UI state.
   */
  hasSensitiveDataConsent: boolean;
  /** Imports the mapped/validated CSV rows. Gated server-side by consent. */
  onImportCsv: (rows: OnboardingCsvPatientRow[]) => Promise<ImportPatientsStepResult>;
  /** Adds a single patient via the existing patient create path. */
  onQuickAdd: (input: {
    fullName: string;
    phone?: string;
    email?: string;
  }) => Promise<QuickAddPatientStepResult>;
  /** Skips the step without ingesting any patient data. */
  onSkip: () => Promise<SkipPatientsStepResult>;
}

// ---------------------------------------------------------------------------
// Quick-add form schema (lightweight — reuses the patients validators)
// ---------------------------------------------------------------------------

const quickAddSchema = z.object({
  fullName: z
    .string({ message: 'Informe o nome do paciente.' })
    .trim()
    .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
    .max(200, { message: 'O nome deve ter no máximo 200 caracteres.' }),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || v === '' || isValidBrazilianPhone(v), {
      message: 'Telefone inválido. Use o formato (11) 98765-4321.',
    }),
  email: z
    .string()
    .trim()
    .email({ message: 'E-mail inválido.' })
    .max(255)
    .optional()
    .or(z.literal('')),
});

type QuickAddInput = z.infer<typeof quickAddSchema>;

type Mode = 'choose' | 'csv' | 'quick-add';
type CsvStage = 'upload' | 'mapping' | 'preview';

/**
 * Wizard step 3 — "Importe pacientes".
 *
 * Offers three options:
 *   (A) CSV upload + column mapping + 5-row preview with validation highlight,
 *       REUSING the patients module's CSV components. DISABLED when the user
 *       has not accepted the sensitive-data consent term (RN-11.03).
 *   (B) Quick "add first patient" via the existing patient create path.
 *   (C) Skip the step.
 *
 * Successful import/create flips `onboarding_checklist.first_patient_added`
 * server-side; skip advances the wizard without ingesting data.
 */
export function StepPatients({
  hasSensitiveDataConsent,
  onImportCsv,
  onQuickAdd,
  onSkip,
}: StepPatientsProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [isSkipping, startSkipping] = useTransition();

  const handleSkip = useCallback(() => {
    startSkipping(async () => {
      const result = await onSkip();
      if (!result.ok) {
        toast.error('Não foi possível pular esta etapa. Tente novamente.');
      }
    });
  }, [onSkip]);

  if (mode === 'csv') {
    return <CsvImportSection onImportCsv={onImportCsv} onBack={() => setMode('choose')} />;
  }

  if (mode === 'quick-add') {
    return <QuickAddSection onQuickAdd={onQuickAdd} onBack={() => setMode('choose')} />;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="step-patients">
      <p className="text-text-secondary text-base">
        Traga seus pacientes para começar. Você pode importar uma planilha, adicionar um paciente
        agora ou fazer isso depois.
      </p>

      <div className="flex flex-col gap-4">
        {/* Option A — CSV upload */}
        <Card
          className={`flex items-start gap-4 p-6 ${
            hasSensitiveDataConsent ? 'hover:border-border-strong cursor-pointer' : 'opacity-70'
          }`}
          role={hasSensitiveDataConsent ? 'button' : undefined}
          tabIndex={hasSensitiveDataConsent ? 0 : undefined}
          onClick={hasSensitiveDataConsent ? () => setMode('csv') : undefined}
          onKeyDown={
            hasSensitiveDataConsent
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setMode('csv');
                  }
                }
              : undefined
          }
          data-testid="step-patients-csv-option"
          aria-disabled={hasSensitiveDataConsent ? undefined : true}
        >
          {hasSensitiveDataConsent ? (
            <Upload className="text-text-tertiary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <Lock className="text-text-tertiary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-1">
            <p className="text-text-primary text-base font-medium">Importar planilha (CSV)</p>
            {hasSensitiveDataConsent ? (
              <p className="text-text-secondary text-sm">
                Suba um arquivo CSV com seus pacientes. Mapeie as colunas e revise antes de
                importar.
              </p>
            ) : (
              <p
                className="text-warning-700 flex items-start gap-1.5 text-sm"
                role="note"
                data-testid="step-patients-csv-consent-blocked"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Para importar pacientes, aceite o termo de dados sensíveis em{' '}
                  <Link
                    href="/configuracoes/privacidade"
                    className="text-brand-700 underline"
                    data-testid="step-patients-privacy-link"
                  >
                    Configurações &gt; Privacidade
                  </Link>
                  .
                </span>
              </p>
            )}
          </div>
        </Card>

        {/* Option B — Quick add */}
        <Card
          className="hover:border-border-strong flex cursor-pointer items-start gap-4 p-6"
          role="button"
          tabIndex={0}
          onClick={() => setMode('quick-add')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setMode('quick-add');
            }
          }}
          data-testid="step-patients-quick-add-option"
        >
          <UserPlus className="text-text-tertiary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-text-primary text-base font-medium">Adicionar paciente</p>
            <p className="text-text-secondary text-sm">
              Cadastre seu primeiro paciente rapidamente com nome e contato.
            </p>
          </div>
        </Card>
      </div>

      {/* Option C — Skip */}
      <Button
        type="button"
        variant="ghost"
        onClick={handleSkip}
        disabled={isSkipping}
        data-testid="step-patients-skip"
        className="self-start"
      >
        {isSkipping ? 'Pulando...' : 'Pular por enquanto'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV import sub-section
// ---------------------------------------------------------------------------

/** Number of preview rows shown before importing (spec: first 5 rows). */
const PREVIEW_LIMIT = 5;

function CsvImportSection({
  onImportCsv,
  onBack,
}: {
  onImportCsv: (rows: OnboardingCsvPatientRow[]) => Promise<ImportPatientsStepResult>;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<CsvStage>('upload');
  const [csvData, setCsvData] = useState<CsvParseResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [activeColumns, setActiveColumns] = useState<PatientField[]>([]);
  const [isImporting, startImporting] = useTransition();

  const handleParsed = useCallback((result: CsvParseResult) => {
    setCsvData(result);
    const detected = detectColumnMapping(result.headers);
    const initialMapping: ColumnMapping = {};
    for (const header of result.headers) {
      initialMapping[header] = detected.mapped[header] ?? null;
    }
    setMapping(initialMapping);
    setStage('mapping');
  }, []);

  const handleConfirmMapping = useCallback(() => {
    if (!csvData) return;

    const mappedFields = Object.entries(mapping)
      .filter((entry): entry is [string, PatientField] => entry[1] != null)
      .reduce(
        (acc, [header, field]) => {
          acc[header] = field;
          return acc;
        },
        {} as Record<string, PatientField>,
      );

    const cols = PATIENT_FIELDS.filter((f) => Object.values(mappedFields).includes(f));
    setActiveColumns(cols);

    // Map + validate. The preview shows only the first 5 rows (spec) with a
    // validation highlight, but the full set is what we import.
    const preview: PreviewRow[] = csvData.rows.slice(0, PREVIEW_LIMIT).map((csvRow, index) => {
      const mappedRow: MappedCsvRow = {};
      const rawData: Partial<Record<PatientField, string>> = {};
      for (const [header, field] of Object.entries(mappedFields)) {
        const value = csvRow[header] ?? '';
        mappedRow[field] = value;
        rawData[field] = value;
      }
      const validation = validateCsvRow(mappedRow);
      return {
        index,
        data: rawData,
        status: validation.valid ? ('valid' as const) : ('error' as const),
        errors: validation.errors,
        warnings: validation.warnings,
      };
    });

    setPreviewRows(preview);
    setStage('preview');
  }, [csvData, mapping]);

  const handleImport = useCallback(() => {
    if (!csvData) return;

    const mappedFields = Object.entries(mapping)
      .filter((entry): entry is [string, PatientField] => entry[1] != null)
      .reduce(
        (acc, [header, field]) => {
          acc[header] = field;
          return acc;
        },
        {} as Record<string, PatientField>,
      );

    // Validate ALL rows (not only the previewed 5) and keep the valid ones.
    const toImport: OnboardingCsvPatientRow[] = [];
    for (const csvRow of csvData.rows) {
      const mappedRow: MappedCsvRow = {};
      for (const [header, field] of Object.entries(mappedFields)) {
        mappedRow[field] = csvRow[header] ?? '';
      }
      if (!validateCsvRow(mappedRow).valid) continue;

      const rawPhone = mappedRow.phone?.trim() ?? '';
      toImport.push({
        fullName: mappedRow.full_name?.trim() ?? '',
        phone: rawPhone.length > 0 ? formatPhone(rawPhone) : null,
        email: mappedRow.email?.trim().toLowerCase() || null,
        birthDate: mappedRow.birth_date?.trim() || null,
        tags: mappedRow.tags
          ? mappedRow.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        notes: mappedRow.notes?.trim() || null,
      });
    }

    if (toImport.length === 0) {
      toast.error('Nenhuma linha válida para importar.');
      return;
    }

    startImporting(async () => {
      const result = await onImportCsv(toImport);
      if (result.ok) {
        toast.success(`${result.importedCount} pacientes importados com sucesso.`);
        return;
      }
      if (result.error === 'consent_required') {
        toast.error('Aceite o termo de dados sensíveis em Configurações > Privacidade.');
        return;
      }
      toast.error('Não foi possível importar os pacientes. Tente novamente.');
    });
  }, [csvData, mapping, onImportCsv]);

  return (
    <div className="flex flex-col gap-6" data-testid="step-patients-csv">
      {stage === 'upload' && (
        <>
          <CsvUpload onParsed={handleParsed} />
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            data-testid="step-patients-csv-cancel"
            className="self-start"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancelar
          </Button>
        </>
      )}

      {stage === 'mapping' && (
        <>
          <CsvColumnMapper
            headers={csvData?.headers ?? []}
            mapping={mapping}
            onMappingChange={setMapping}
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStage('upload')}
              data-testid="step-patients-mapping-back"
            >
              Voltar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmMapping}
              disabled={!Object.values(mapping).some((v) => v === 'full_name')}
              data-testid="step-patients-mapping-confirm"
            >
              Continuar
            </Button>
          </div>
        </>
      )}

      {stage === 'preview' && (
        <>
          <p className="text-text-secondary text-sm">
            Pré-visualização das primeiras {PREVIEW_LIMIT} linhas. Linhas com erro não serão
            importadas.
          </p>
          <CsvPreviewTable
            rows={previewRows}
            columns={activeColumns}
            isImporting={isImporting}
            onImport={handleImport}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setStage('mapping')}
            disabled={isImporting}
            data-testid="step-patients-preview-back"
            className="self-start"
          >
            Voltar ao mapeamento
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-add sub-section
// ---------------------------------------------------------------------------

function QuickAddSection({
  onQuickAdd,
  onBack,
}: {
  onQuickAdd: (input: {
    fullName: string;
    phone?: string;
    email?: string;
  }) => Promise<QuickAddPatientStepResult>;
  onBack: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const ids = {
    fullName: useId(),
    phone: useId(),
    email: useId(),
  } as const;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<QuickAddInput>({
    resolver: zodResolver(quickAddSchema),
    mode: 'onTouched',
    defaultValues: { fullName: '', phone: '', email: '' },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await onQuickAdd({
        fullName: data.fullName,
        phone: data.phone || undefined,
        email: data.email || undefined,
      });

      if (result.ok) {
        toast.success('Paciente adicionado.');
        return;
      }

      if (result.error === 'invalid_input' && result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (
            messages.length > 0 &&
            (field === 'fullName' || field === 'phone' || field === 'email')
          ) {
            setError(field, { type: 'server', message: messages[0] });
          }
        }
        return;
      }
      if (result.error === 'duplicate_phone') {
        setError('phone', { type: 'server', message: 'Já existe um paciente com este telefone.' });
        return;
      }
      if (result.error === 'duplicate_email') {
        setError('email', { type: 'server', message: 'Já existe um paciente com este e-mail.' });
        return;
      }
      toast.error('Não foi possível adicionar o paciente. Tente novamente.');
    });
  });

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="flex flex-col gap-5"
      noValidate
      data-testid="step-patients-quick-add-form"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.fullName}>Nome do paciente</Label>
        <Input
          id={ids.fullName}
          type="text"
          placeholder="Nome completo"
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={errors.fullName ? `${ids.fullName}-error` : undefined}
          data-testid="step-patients-quick-add-name"
          {...register('fullName')}
        />
        {errors.fullName?.message ? (
          <p
            id={`${ids.fullName}-error`}
            role="alert"
            className="text-danger-700 flex items-center gap-1 text-sm"
            data-testid="step-patients-quick-add-name-error"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errors.fullName.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.phone}>Telefone (opcional)</Label>
        <Input
          id={ids.phone}
          type="tel"
          placeholder="(11) 98765-4321"
          aria-invalid={errors.phone ? true : undefined}
          data-testid="step-patients-quick-add-phone"
          {...register('phone')}
        />
        {errors.phone?.message ? (
          <p role="alert" className="text-danger-700 flex items-center gap-1 text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errors.phone.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.email}>E-mail (opcional)</Label>
        <Input
          id={ids.email}
          type="email"
          placeholder="email@exemplo.com"
          aria-invalid={errors.email ? true : undefined}
          data-testid="step-patients-quick-add-email"
          {...register('email')}
        />
        {errors.email?.message ? (
          <p role="alert" className="text-danger-700 flex items-center gap-1 text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          disabled={isPending}
          data-testid="step-patients-quick-add-back"
        >
          Voltar
        </Button>
        <Button type="submit" disabled={isPending} data-testid="step-patients-quick-add-submit">
          {isPending ? 'Adicionando...' : 'Adicionar paciente'}
        </Button>
      </div>
    </form>
  );
}
