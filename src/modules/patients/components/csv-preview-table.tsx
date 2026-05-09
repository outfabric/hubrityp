'use client';

import { AlertCircle, FileText, Loader2 } from 'lucide-react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

import type { PatientField } from '../lib/csv-column-mapping';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RowStatus = 'valid' | 'error' | 'duplicate';

export interface PreviewRow {
  /** Index in the original CSV (0-based). */
  index: number;
  /** Mapped field values. */
  data: Partial<Record<PatientField, string>>;
  /** Row status after validation + duplicate check. */
  status: RowStatus;
  /** Error messages (validation failures). */
  errors: string[];
  /** Warning messages (e.g. duplicates). */
  warnings: string[];
}

interface CsvPreviewTableProps {
  /** Rows to display in the preview. */
  rows: PreviewRow[];
  /** Columns to display (mapped fields only). */
  columns: PatientField[];
  /** Whether the import action is in progress. */
  isImporting: boolean;
  /** Called when the user clicks "Importar". */
  onImport: () => void;
}

// ---------------------------------------------------------------------------
// Column display names
// ---------------------------------------------------------------------------

const COLUMN_LABELS: Record<PatientField, string> = {
  full_name: 'Nome',
  phone: 'Telefone',
  email: 'E-mail',
  birth_date: 'Nascimento',
  tags: 'Tags',
  notes: 'Observacoes',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRowBgClass(status: RowStatus): string {
  switch (status) {
    case 'error':
      return 'bg-danger-50';
    case 'duplicate':
      return 'bg-warning-50';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Preview table for CSV import showing validation results.
 *
 * Design system: Table with semantic row colors, summary badges on top,
 * import button with loading state. Mobile: cards stacked.
 */
export function CsvPreviewTable({ rows, columns, isImporting, onImport }: CsvPreviewTableProps) {
  const totalRows = rows.length;
  const validRows = rows.filter((r) => r.status === 'valid').length;
  const errorRows = rows.filter((r) => r.status === 'error').length;
  const duplicateRows = rows.filter((r) => r.status === 'duplicate').length;

  const canImport = validRows > 0 && !isImporting;

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  if (totalRows === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        data-testid="csv-preview-empty"
      >
        <FileText className="text-text-tertiary mb-4 h-12 w-12" aria-hidden="true" />
        <h4 className="text-text-primary text-base font-medium">Nenhuma linha valida</h4>
        <p className="text-text-secondary mt-2 max-w-sm text-[15px]">
          O arquivo CSV nao contem linhas que possam ser importadas. Verifique o formato e tente
          novamente.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-4" data-testid="csv-preview">
      {/* Summary badges */}
      <div className="flex flex-wrap items-center gap-2" data-testid="csv-preview-summary">
        <Badge variant="neutral">{totalRows} linhas</Badge>
        <Badge variant="success">{validRows} validas</Badge>
        {errorRows > 0 && <Badge variant="danger">{errorRows} com erros</Badge>}
        {duplicateRows > 0 && <Badge variant="warning">{duplicateRows} duplicadas</Badge>}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <Table data-testid="csv-preview-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">#</TableHead>
              {columns.map((col) => (
                <TableHead key={col}>{COLUMN_LABELS[col]}</TableHead>
              ))}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.index} className={getRowBgClass(row.status)}>
                <TableCell className="text-text-secondary text-[13px]">{row.index + 1}</TableCell>
                {columns.map((col) => (
                  <TableCell key={col} className="text-[13px]">
                    {row.data[col] || <span className="text-text-disabled">-</span>}
                  </TableCell>
                ))}
                <TableCell>
                  {row.status === 'valid' && <Badge variant="success">Valida</Badge>}
                  {row.status === 'error' && (
                    <div className="space-y-1">
                      <Badge variant="danger">Erro</Badge>
                      {row.errors.map((err) => (
                        <div
                          key={err}
                          className="text-danger-700 flex items-start gap-1 text-[12px]"
                        >
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {row.status === 'duplicate' && (
                    <div className="space-y-1">
                      <Badge variant="warning">Duplicada</Badge>
                      {row.warnings.map((warn) => (
                        <div key={warn} className="text-warning-700 text-[12px]">
                          {warn}
                        </div>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden" data-testid="csv-preview-cards-mobile">
        {rows.map((row) => (
          <div
            key={row.index}
            className={`border-border rounded-xl border p-4 ${getRowBgClass(row.status)}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-text-secondary text-[13px]">Linha {row.index + 1}</span>
              {row.status === 'valid' && <Badge variant="success">Valida</Badge>}
              {row.status === 'error' && <Badge variant="danger">Erro</Badge>}
              {row.status === 'duplicate' && <Badge variant="warning">Duplicada</Badge>}
            </div>

            <div className="space-y-1">
              {columns.map((col) => (
                <div key={col} className="flex items-baseline gap-2 text-[13px]">
                  <span className="text-text-tertiary min-w-[80px] shrink-0">
                    {COLUMN_LABELS[col]}:
                  </span>
                  <span className="text-text-primary">
                    {row.data[col] || <span className="text-text-disabled">-</span>}
                  </span>
                </div>
              ))}
            </div>

            {row.status === 'error' &&
              row.errors.map((err) => (
                <div key={err} className="text-danger-700 mt-2 flex items-start gap-1 text-[12px]">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{err}</span>
                </div>
              ))}

            {row.status === 'duplicate' &&
              row.warnings.map((warn) => (
                <div key={warn} className="text-warning-700 mt-2 text-[12px]">
                  {warn}
                </div>
              ))}
          </div>
        ))}
      </div>

      {/* Import button */}
      <div className="flex justify-end pt-2">
        <Button onClick={onImport} disabled={!canImport} data-testid="csv-import-button">
          {isImporting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Importando...
            </>
          ) : validRows > 0 ? (
            `Importar ${validRows} paciente${validRows !== 1 ? 's' : ''}`
          ) : (
            'Nenhuma linha valida para importar'
          )}
        </Button>
      </div>
    </div>
  );
}
