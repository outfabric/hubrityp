'use client';

/**
 * RecurrenceFormSection — collapsible sub-form for recurrence rules.
 *
 * Integrates with a parent `<Form>` (React Hook Form `FormProvider`) via
 * `useFormContext`. When the "Sessão recorrente" checkbox is checked, a
 * `Collapsible` reveals frequency, day-of-week, and end-condition controls.
 *
 * Field paths written to the form context:
 *   - `recurrence.frequency`     — 'weekly' | 'biweekly' | 'monthly' | 'custom'
 *   - `recurrence.daysOfWeek`    — number[] (0=Sun … 6=Sat)
 *   - `recurrence.endDate`       — ISO string (when end condition = 'date')
 *   - `recurrence.occurrenceCount` — number (when end condition = 'count')
 *   - `recurrence.isIndefinite`  — boolean (when end condition = 'indefinite')
 *
 * Design System Salvia:
 *   - Entire section: bg `surface-sunken`, radius `lg`, padding `space-4`
 *   - Collapsible animation: 200ms (duration-base)
 *   - ToggleGroup items: 40x40px, radius `md`, active bg `brand-500` text `inverse`
 */

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import * as React from 'react';
import { useFormContext } from 'react-hook-form';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Checkbox } from '@/shared/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/shared/ui/collapsible';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quinzenal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'custom', label: 'Personalizada' },
] as const;

/** Day labels in abbreviated form (D/S/T/Q/Q/S/S), starting at Sunday. */
const DAY_ITEMS = [
  { value: '0', abbrev: 'D', full: 'Domingo' },
  { value: '1', abbrev: 'S', full: 'Segunda-feira' },
  { value: '2', abbrev: 'T', full: 'Terça-feira' },
  { value: '3', abbrev: 'Q', full: 'Quarta-feira' },
  { value: '4', abbrev: 'Q', full: 'Quinta-feira' },
  { value: '5', abbrev: 'S', full: 'Sexta-feira' },
  { value: '6', abbrev: 'S', full: 'Sábado' },
] as const;

type EndCondition = 'date' | 'count' | 'indefinite';

// ---------------------------------------------------------------------------
// Helper — whether frequency requires day-of-week selection
// ---------------------------------------------------------------------------

function showDaysOfWeek(frequency: string | undefined): boolean {
  return frequency === 'weekly' || frequency === 'custom';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecurrenceFormSection() {
  const { setValue, watch } = useFormContext();

  const [isRecurring, setIsRecurring] = React.useState(false);
  const [endCondition, setEndCondition] = React.useState<EndCondition>('indefinite');

  const frequency = watch('recurrence.frequency') as string | undefined;

  // Derive daysOfWeek from form state so ToggleGroup stays in sync
  const daysOfWeek = (watch('recurrence.daysOfWeek') as number[] | undefined) ?? [];

  // Keep isIndefinite synced when the section is opened for the first time
  React.useEffect(() => {
    if (isRecurring && endCondition === 'indefinite') {
      setValue('recurrence.isIndefinite', true);
    }
  }, [isRecurring, endCondition, setValue]);

  // ---- Handlers -----------------------------------------------------------

  function handleRecurringToggle(checked: boolean) {
    setIsRecurring(checked);
    if (!checked) {
      // Clear all recurrence fields when unchecked
      setValue('recurrence.frequency', undefined);
      setValue('recurrence.daysOfWeek', undefined);
      setValue('recurrence.endDate', undefined);
      setValue('recurrence.occurrenceCount', undefined);
      setValue('recurrence.isIndefinite', false);
    }
  }

  function handleFrequencyChange(value: string) {
    setValue('recurrence.frequency', value);
    // Clear daysOfWeek when switching to a frequency that doesn't need it
    if (!showDaysOfWeek(value)) {
      setValue('recurrence.daysOfWeek', undefined);
    }
  }

  function handleDaysChange(values: string[]) {
    setValue('recurrence.daysOfWeek', values.map(Number));
  }

  function handleEndConditionChange(value: string) {
    const condition = value as EndCondition;
    setEndCondition(condition);

    // Reset fields that belong to the other end conditions
    if (condition !== 'date') setValue('recurrence.endDate', undefined);
    if (condition !== 'count') setValue('recurrence.occurrenceCount', undefined);
    setValue('recurrence.isIndefinite', condition === 'indefinite');
  }

  function handleDateSelect(date: Date | undefined) {
    if (date) {
      setValue('recurrence.endDate', date.toISOString());
    }
  }

  function handleOccurrenceCountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '') {
      setValue('recurrence.occurrenceCount', undefined);
      return;
    }
    const num = parseInt(raw, 10);
    if (!Number.isNaN(num)) {
      setValue('recurrence.occurrenceCount', num);
    }
  }

  // ---- Derived display values ---------------------------------------------

  const endDateIso = watch('recurrence.endDate') as string | undefined;
  const endDateObj = endDateIso ? new Date(endDateIso) : undefined;
  const endDateFormatted = endDateObj
    ? format(endDateObj, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
    : undefined;

  const occurrenceCount = watch('recurrence.occurrenceCount') as number | undefined;

  // ---- Render -------------------------------------------------------------

  return (
    <div data-testid="recurrence-section" className="flex flex-col gap-3">
      {/* Checkbox trigger */}
      <div className="flex items-center gap-3">
        <Checkbox
          id="recurrence-toggle"
          data-testid="recurrence-toggle"
          checked={isRecurring}
          onCheckedChange={(checked) => handleRecurringToggle(checked === true)}
        />
        <Label htmlFor="recurrence-toggle">Sessão recorrente</Label>
      </div>

      {/* Collapsible body */}
      <Collapsible open={isRecurring}>
        <CollapsibleContent
          className={cn(
            'bg-surface-sunken rounded-lg p-4',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'duration-base',
          )}
        >
          <div className="flex flex-col gap-4">
            {/* 1. Frequency */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Frequência</Label>
              <RadioGroup
                aria-label="Frequência da recorrência"
                value={frequency ?? ''}
                onValueChange={handleFrequencyChange}
                data-testid="frequency-radio-group"
              >
                {FREQUENCY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex items-center gap-3">
                    <RadioGroupItem
                      value={opt.value}
                      id={`freq-${opt.value}`}
                      data-testid={`freq-${opt.value}`}
                    />
                    <Label htmlFor={`freq-${opt.value}`} className="font-normal">
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* 2. Days of week — visible for weekly / custom */}
            {showDaysOfWeek(frequency) && (
              <div className="flex flex-col gap-2" data-testid="days-of-week-section">
                <Label className="text-sm font-medium">Dias da semana</Label>
                <ToggleGroup
                  type="multiple"
                  value={daysOfWeek.map(String)}
                  onValueChange={handleDaysChange}
                  className="flex gap-2"
                  data-testid="days-toggle-group"
                >
                  {DAY_ITEMS.map((day) => (
                    <ToggleGroupItem
                      key={day.value}
                      value={day.value}
                      aria-label={day.full}
                      data-testid={`day-${day.value}`}
                      className={cn(
                        'h-10 w-10 rounded-md border text-sm font-medium',
                        'bg-surface-muted text-text-secondary border-border',
                        'data-[state=on]:bg-brand-500 data-[state=on]:text-text-inverse data-[state=on]:border-brand-500',
                        'focus-visible:shadow-focus focus-visible:outline-none',
                        'duration-fast transition-colors',
                      )}
                    >
                      {day.abbrev}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}

            {/* 3. End condition */}
            <div className="flex flex-col gap-2">
              <h4 className="text-base font-medium">Repetir até</h4>
              <RadioGroup
                value={endCondition}
                onValueChange={handleEndConditionChange}
                data-testid="end-condition-radio-group"
              >
                {/* Data específica */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value="date" id="end-date" data-testid="end-condition-date" />
                    <Label htmlFor="end-date" className="font-normal">
                      Data específica
                    </Label>
                  </div>
                  {endCondition === 'date' && (
                    <div className="ml-8" data-testid="end-date-picker">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full justify-start text-left font-normal',
                              !endDateFormatted && 'text-text-tertiary',
                            )}
                            data-testid="end-date-trigger"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                            {endDateFormatted ?? 'Selecione uma data'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={endDateObj}
                            onSelect={handleDateSelect}
                            locale={ptBR}
                            disabled={(date) => date < new Date()}
                            data-testid="end-date-calendar"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>

                {/* Número de sessões */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <RadioGroupItem
                      value="count"
                      id="end-count"
                      data-testid="end-condition-count"
                    />
                    <Label htmlFor="end-count" className="font-normal">
                      Número de sessões
                    </Label>
                  </div>
                  {endCondition === 'count' && (
                    <div className="ml-8" data-testid="occurrence-count-section">
                      <Input
                        type="number"
                        min={2}
                        max={104}
                        value={occurrenceCount ?? ''}
                        onChange={handleOccurrenceCountChange}
                        placeholder="Ex: 12"
                        data-testid="occurrence-count-input"
                        className="w-32"
                      />
                    </div>
                  )}
                </div>

                {/* Indefinido */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <RadioGroupItem
                      value="indefinite"
                      id="end-indefinite"
                      data-testid="end-condition-indefinite"
                    />
                    <Label htmlFor="end-indefinite" className="font-normal">
                      Indefinido
                    </Label>
                  </div>
                  {endCondition === 'indefinite' && (
                    <p className="text-text-tertiary ml-8 text-xs" data-testid="indefinite-helper">
                      As sessões serão geradas continuamente até que você cancele a recorrência.
                    </p>
                  )}
                </div>
              </RadioGroup>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
