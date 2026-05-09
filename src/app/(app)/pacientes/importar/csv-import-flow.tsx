'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { CheckCsvDuplicatesResult, DuplicateCandidate } from '@/modules/patients';
import type { CsvPatientRow, ImportPatientsCsvResult } from '@/modules/patients';
import type { ColumnMapping } from '@/modules/patients/components/csv-column-mapper';
import { CsvColumnMapper } from '@/modules/patients/components/csv-column-mapper';
import type { PreviewRow } from '@/modules/patients/components/csv-preview-table';
import { CsvPreviewTable } from '@/modules/patients/components/csv-preview-table';
import type { CsvParseResult } from '@/modules/patients/components/csv-upload';
import { CsvUpload } from '@/modules/patients/components/csv-upload';
import type { PatientField } from '@/modules/patients/lib/csv-column-mapping';
import { detectColumnMapping, PATIENT_FIELDS } from '@/modules/patients/lib/csv-column-mapping';
import { formatPhone } from '@/modules/patients/lib/patient-validators';
import type { MappedCsvRow } from '@/modules/patients/lib/validate-csv-row';
import { validateCsvRow } from '@/modules/patients/lib/validate-csv-row';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'upload' | 'mapping' | 'preview';

interface CsvImportFlowProps {
  checkDuplicatesAction: (candidates: DuplicateCandidate[]) => Promise<CheckCsvDuplicatesResult>;
  importAction: (rows: CsvPatientRow[]) => Promise<ImportPatientsCsvResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Orchestrates the CSV import flow: upload -> column mapping -> preview with
 * validation -> confirm import.
 */
export function CsvImportFlow({ checkDuplicatesAction, importAction }: CsvImportFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [csvData, setCsvData] = useState<CsvParseResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [activeColumns, setActiveColumns] = useState<PatientField[]>([]);
  const [isChecking, startChecking] = useTransition();
  const [isImporting, startImporting] = useTransition();

  // Step 1: File parsed successfully
  const handleParsed = useCallback((result: CsvParseResult) => {
    setCsvData(result);

    // Auto-detect column mapping
    const detected = detectColumnMapping(result.headers);
    const initialMapping: ColumnMapping = {};
    for (const header of result.headers) {
      initialMapping[header] = detected.mapped[header] ?? null;
    }
    setMapping(initialMapping);
    setStep('mapping');
  }, []);

  // Step 2: User confirms mapping, validate and check duplicates
  const handleConfirmMapping = useCallback(() => {
    if (!csvData) return;

    // Build mapped rows
    const mappedFields = Object.entries(mapping)
      .filter((entry): entry is [string, PatientField] => entry[1] != null)
      .reduce(
        (acc, [header, field]) => {
          acc[header] = field;
          return acc;
        },
        {} as Record<string, PatientField>,
      );

    // Determine which columns are active (for the preview table)
    const cols = PATIENT_FIELDS.filter((f) => Object.values(mappedFields).includes(f));
    setActiveColumns(cols);

    // Map and validate each row
    const mapped: { row: MappedCsvRow; rawData: Partial<Record<PatientField, string>> }[] =
      csvData.rows.map((csvRow) => {
        const mappedRow: MappedCsvRow = {};
        const rawData: Partial<Record<PatientField, string>> = {};

        for (const [header, field] of Object.entries(mappedFields)) {
          const value = csvRow[header] ?? '';
          mappedRow[field] = value;
          rawData[field] = value;
        }

        return { row: mappedRow, rawData };
      });

    // Validate rows client-side
    const validated = mapped.map((item, index) => {
      const result = validateCsvRow(item.row);
      return {
        index,
        data: item.rawData,
        mappedRow: item.row,
        validation: result,
      };
    });

    // Build candidates for server-side duplicate check
    const candidates: DuplicateCandidate[] = validated
      .filter((v) => v.validation.valid)
      .map((v) => {
        const rawPhone = v.mappedRow.phone?.trim() ?? '';
        const formatted = rawPhone.length > 0 ? formatPhone(rawPhone) : undefined;
        return {
          phone: formatted || undefined,
          email: v.mappedRow.email?.trim().toLowerCase() || undefined,
        };
      });

    startChecking(async () => {
      let duplicatePhones = new Set<string>();
      let duplicateEmails = new Set<string>();

      // Only call server if there are valid rows with phones/emails
      if (candidates.some((c) => c.phone || c.email)) {
        const dupResult = await checkDuplicatesAction(candidates);
        if (dupResult.ok) {
          duplicatePhones = new Set(dupResult.duplicatePhones);
          duplicateEmails = new Set(dupResult.duplicateEmails);
        }
      }

      // Build preview rows with validation + duplicate status
      const preview: PreviewRow[] = validated.map((v) => {
        // Check if this valid row is a duplicate
        if (v.validation.valid) {
          const rawPhone = v.mappedRow.phone?.trim() ?? '';
          const formatted = rawPhone.length > 0 ? formatPhone(rawPhone) : '';
          const email = v.mappedRow.email?.trim().toLowerCase() ?? '';

          const isDupPhone = formatted.length > 0 && duplicatePhones.has(formatted);
          const isDupEmail = email.length > 0 && duplicateEmails.has(email);

          if (isDupPhone || isDupEmail) {
            const warnings: string[] = [];
            if (isDupPhone) warnings.push('Paciente com este telefone já existe.');
            if (isDupEmail) warnings.push('Paciente com este e-mail já existe.');

            return {
              index: v.index,
              data: v.data,
              status: 'duplicate' as const,
              errors: [],
              warnings,
            };
          }

          return {
            index: v.index,
            data: v.data,
            status: 'valid' as const,
            errors: [],
            warnings: [],
          };
        }

        return {
          index: v.index,
          data: v.data,
          status: 'error' as const,
          errors: v.validation.errors,
          warnings: v.validation.warnings,
        };
      });

      setPreviewRows(preview);
      setStep('preview');
    });
  }, [csvData, mapping, checkDuplicatesAction]);

  // Step 3: Import confirmed
  const handleImport = useCallback(() => {
    if (!csvData) return;

    const validRows = previewRows.filter((r) => r.status === 'valid');
    if (validRows.length === 0) return;

    // Build CsvPatientRow for each valid row
    const rowsToImport: CsvPatientRow[] = validRows.map((r) => ({
      fullName: r.data.full_name ?? '',
      phone: r.data.phone ? formatPhone(r.data.phone.trim()) : null,
      email: r.data.email?.trim().toLowerCase() || null,
      birthDate: r.data.birth_date?.trim() || null,
      tags: r.data.tags
        ? r.data.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      notes: r.data.notes?.trim() || null,
    }));

    startImporting(async () => {
      const result = await importAction(rowsToImport);

      if (result.ok) {
        toast.success(`${result.importedCount} pacientes importados com sucesso`);
        router.push('/pacientes');
      } else {
        const message =
          'message' in result ? result.message : 'Erro ao importar pacientes. Tente novamente.';
        toast.error(message);
      }
    });
  }, [csvData, previewRows, importAction, router]);

  // Reset flow to go back to upload
  const handleReset = useCallback(() => {
    setCsvData(null);
    setMapping({});
    setPreviewRows([]);
    setActiveColumns([]);
    setStep('upload');
  }, []);

  // -------------------------------------------------------------------------
  // Render by step
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {step === 'upload' && <CsvUpload onParsed={handleParsed} />}

      {step === 'mapping' && (
        <div className="space-y-6">
          <CsvColumnMapper
            headers={csvData?.headers ?? []}
            mapping={mapping}
            onMappingChange={setMapping}
          />
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleReset} data-testid="csv-mapping-back">
              Voltar
            </Button>
            <Button
              onClick={handleConfirmMapping}
              disabled={isChecking || !Object.values(mapping).some((v) => v === 'full_name')}
              data-testid="csv-mapping-confirm"
            >
              {isChecking ? 'Verificando...' : 'Continuar'}
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-6">
          <CsvPreviewTable
            rows={previewRows}
            columns={activeColumns}
            isImporting={isImporting}
            onImport={handleImport}
          />
          <div>
            <Button
              variant="secondary"
              onClick={() => setStep('mapping')}
              disabled={isImporting}
              data-testid="csv-preview-back"
            >
              Voltar ao mapeamento
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
