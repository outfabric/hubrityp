'use client';

/**
 * CoupleSessionFields — toggle + second-patient selector for couple sessions.
 *
 * Integrates with a parent `<Form>` (React Hook Form `FormProvider`) via
 * `useFormContext`. When the "Atendimento de casal" checkbox is checked, a
 * second patient `Select` appears (label "Segundo paciente"). The dropdown
 * filters out the patient already selected in the primary field to prevent
 * duplicates. An inline validation error in `danger-700` fires when the same
 * patient somehow ends up in both slots.
 *
 * Field paths written to the form context:
 *   - `couple.enabled`          — boolean
 *   - `couple.secondPatientId`  — string (UUID)
 *
 * Reads from form context:
 *   - `patientId` — the primary patient, used to filter the second select.
 *
 * Design System Salvia:
 *   - Checkbox + Label, gap `space-3`
 *   - Second Select revealed on check, gap `space-3`
 *   - Inline error text in `danger-700`
 */

import * as React from 'react';
import { useFormContext } from 'react-hook-form';

import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientOption {
  id: string;
  name: string;
}

export interface CoupleSessionFieldsProps {
  /** Full list of patients available for selection. */
  patients: PatientOption[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CoupleSessionFields({ patients }: CoupleSessionFieldsProps) {
  const { setValue, watch } = useFormContext();

  const isCouple = (watch('couple.enabled') as boolean | undefined) ?? false;
  const primaryPatientId = watch('patientId') as string | undefined;
  const secondPatientId = watch('couple.secondPatientId') as string | undefined;

  // Derive whether the duplicate-patient error should be shown
  const hasDuplicateError =
    isCouple && !!primaryPatientId && !!secondPatientId && primaryPatientId === secondPatientId;

  // Filter second-patient options: exclude the primary patient
  const filteredPatients = React.useMemo(
    () => patients.filter((p) => p.id !== primaryPatientId),
    [patients, primaryPatientId],
  );

  // ---- Handlers -----------------------------------------------------------

  function handleCoupleToggle(checked: boolean) {
    setValue('couple.enabled', checked);
    if (!checked) {
      setValue('couple.secondPatientId', undefined);
    }
  }

  function handleSecondPatientChange(value: string) {
    setValue('couple.secondPatientId', value);
  }

  // ---- Render -------------------------------------------------------------

  return (
    <div data-testid="couple-session-section" className="flex flex-col gap-3">
      {/* Checkbox trigger */}
      <div className="flex items-center gap-3">
        <Checkbox
          id="couple-toggle"
          data-testid="couple-toggle"
          checked={isCouple}
          onCheckedChange={(checked) => handleCoupleToggle(checked === true)}
          aria-label="Atendimento de casal"
        />
        <Label htmlFor="couple-toggle">Atendimento de casal</Label>
      </div>

      {/* Second patient selector — visible only when couple mode is on */}
      {isCouple && (
        <div className="flex flex-col gap-2" data-testid="second-patient-section">
          <Label htmlFor="second-patient-select">Segundo paciente</Label>
          <Select value={secondPatientId ?? ''} onValueChange={handleSecondPatientChange}>
            <SelectTrigger
              id="second-patient-select"
              data-testid="second-patient-select"
              aria-invalid={hasDuplicateError}
            >
              <SelectValue placeholder="Selecione o segundo paciente" />
            </SelectTrigger>
            <SelectContent>
              {filteredPatients.map((patient) => (
                <SelectItem
                  key={patient.id}
                  value={patient.id}
                  data-testid={`patient-option-${patient.id}`}
                >
                  {patient.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Inline validation error */}
          {hasDuplicateError && (
            <p
              className="text-danger-700 text-sm"
              role="alert"
              data-testid="couple-duplicate-error"
            >
              Selecione pacientes diferentes
            </p>
          )}
        </div>
      )}
    </div>
  );
}
