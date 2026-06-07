'use client';

/**
 * LateRecordToggle — checkbox for marking a session as a retroactive record.
 *
 * Integrates with a parent `<Form>` (React Hook Form `FormProvider`) via
 * `useFormContext`. Only rendered when the selected date/time is in the past.
 * When checked, the component sets the form `status` field to `'done'`.
 *
 * Field paths written to the form context:
 *   - `lateRecord`  — boolean (whether the session is a late record)
 *   - `status`      — set to `'done'` when `lateRecord` is checked
 *
 * Design System Salvia:
 *   - Checkbox + Label, gap `space-3`
 *   - Helper text caption in `text-tertiary`
 */

import { useFormContext } from 'react-hook-form';

import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LateRecordToggleProps {
  /** The date/time currently selected in the session form. */
  selectedDateTime: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInThePast(date: Date): boolean {
  return date.getTime() < Date.now();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LateRecordToggle({ selectedDateTime }: LateRecordToggleProps) {
  const { setValue, watch } = useFormContext();

  const isLateRecord = (watch('lateRecord') as boolean | undefined) ?? false;

  // Only render when the selected date/time is in the past
  if (!selectedDateTime || !isInThePast(selectedDateTime)) {
    return null;
  }

  function handleToggle(checked: boolean) {
    setValue('lateRecord', checked);
    if (checked) {
      setValue('status', 'done');
    }
  }

  return (
    <div data-testid="late-record-section" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Checkbox
          id="late-record-toggle"
          data-testid="late-record-toggle"
          checked={isLateRecord}
          onCheckedChange={(checked) => handleToggle(checked === true)}
          aria-label="Marcar como lançamento retroativo"
        />
        <Label htmlFor="late-record-toggle">Lançamento retroativo</Label>
      </div>

      {isLateRecord && (
        <p className="text-text-tertiary text-xs" data-testid="late-record-helper">
          Esta sessão já foi realizada e será registrada como concluída
        </p>
      )}
    </div>
  );
}
