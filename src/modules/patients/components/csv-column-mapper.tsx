'use client';

import { ArrowRight } from 'lucide-react';
import { useCallback } from 'react';

import { Card } from '@/shared/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import type { PatientField } from '../lib/csv-column-mapping';
import { PATIENT_FIELDS } from '../lib/csv-column-mapping';

// ---------------------------------------------------------------------------
// Field labels for display (pt-BR)
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<PatientField | '__skip__', string> = {
  full_name: 'Nome completo',
  phone: 'Telefone',
  email: 'E-mail',
  birth_date: 'Data de nascimento',
  tags: 'Tags',
  notes: 'Observacoes',
  __skip__: 'Ignorar coluna',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Current mapping state: CSV header -> patient field or null (unmapped). */
export type ColumnMapping = Record<string, PatientField | null>;

interface CsvColumnMapperProps {
  /** CSV headers from the parsed file. */
  headers: string[];
  /** Current mapping state. */
  mapping: ColumnMapping;
  /** Called when the user changes a column mapping. */
  onMappingChange: (mapping: ColumnMapping) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Column mapping UI for CSV import.
 *
 * Each CSV column is shown as a row in a flat Card. The user picks which
 * patient field each CSV column maps to via a Select dropdown.
 *
 * Design system: Card flat per row, Label + ArrowRight + Select, gap space-4.
 */
export function CsvColumnMapper({ headers, mapping, onMappingChange }: CsvColumnMapperProps) {
  // Track which fields are already assigned so they cannot be double-picked
  const usedFields = new Set(Object.values(mapping).filter((v): v is PatientField => v != null));

  const handleChange = useCallback(
    (header: string, value: string) => {
      const field = value === '__skip__' ? null : (value as PatientField);
      onMappingChange({ ...mapping, [header]: field });
    },
    [mapping, onMappingChange],
  );

  return (
    <div className="space-y-4" data-testid="csv-column-mapper">
      <p className="text-text-secondary text-[13px]">
        Associe as colunas do CSV aos campos do sistema.
      </p>

      <div className="space-y-3">
        {headers.map((header) => {
          const currentField = mapping[header] ?? null;

          return (
            <Card
              key={header}
              className="flex items-center gap-4 border-0 p-4 shadow-none"
              data-testid="csv-column-row"
            >
              {/* CSV column label */}
              <span
                className="text-text-primary min-w-[120px] flex-1 truncate text-[15px] font-medium"
                title={header}
              >
                {header}
              </span>

              {/* Arrow */}
              <ArrowRight className="text-text-tertiary h-4 w-4 shrink-0" aria-hidden="true" />

              {/* System field select */}
              <div className="min-w-[180px] flex-1">
                <Select
                  value={currentField ?? '__skip__'}
                  onValueChange={(v) => handleChange(header, v)}
                >
                  <SelectTrigger
                    aria-label={`Campo para coluna ${header}`}
                    data-testid="csv-column-select"
                  >
                    <SelectValue placeholder="Selecionar campo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__skip__">{FIELD_LABELS.__skip__}</SelectItem>
                    {PATIENT_FIELDS.map((field) => (
                      <SelectItem
                        key={field}
                        value={field}
                        disabled={usedFields.has(field) && currentField !== field}
                      >
                        {FIELD_LABELS[field]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
