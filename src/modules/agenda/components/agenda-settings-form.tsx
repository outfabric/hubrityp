'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { saveAgendaSettings } from '@/app/(app)/configuracoes/agenda/actions';
import {
  agendaSettingsInputSchema,
  type AgendaSettingsInput,
} from '@/modules/agenda/lib/agenda-settings-input-schema';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DURATION_OPTIONS = [30, 40, 45, 50, 60, 90, 120] as const;
const INTERVAL_OPTIONS = [0, 5, 10, 15, 20, 30] as const;

const DAY_LABELS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'] as const;

/** 06:00 to 22:00 in 30-min steps */
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 6; h <= 22; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 22) {
      slots.push(`${String(h).padStart(2, '0')}:30`);
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

/** Same 6 colors used in the location form */
const PRESET_COLORS = [
  { label: 'Verde', value: '#6b8a66' },
  { label: 'Azul', value: '#5b7a93' },
  { label: 'Roxo', value: '#7b6b93' },
  { label: 'Rosa', value: '#b0594b' },
  { label: 'Laranja', value: '#c28a3d' },
  { label: 'Amarelo', value: '#8c6128' },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single business-hour entry from the server (jsonb) */
interface BusinessHourEntry {
  day: number;
  start: string;
  end: string;
}

/** Intermediate form state for a single day row */
interface DayRow {
  enabled: boolean;
  start: string;
  end: string;
}

interface AgendaSettingsFormProps {
  settings: {
    defaultDurationMinutes: number;
    intervalMinutes: number;
    businessHours: unknown;
    cancellationPolicy: string | null;
    defaultColor: string | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert server business hours (array of active days) to 7-row array. */
function toFormDays(businessHours: unknown): DayRow[] {
  const entries = (Array.isArray(businessHours) ? businessHours : []) as BusinessHourEntry[];
  const map = new Map<number, BusinessHourEntry>();
  for (const entry of entries) {
    map.set(entry.day, entry);
  }

  return Array.from({ length: 7 }, (_, i) => {
    const entry = map.get(i);
    if (entry) {
      return { enabled: true, start: entry.start, end: entry.end };
    }
    return { enabled: false, start: '08:00', end: '18:00' };
  });
}

/** Convert the 7-row form state back to the schema format (only enabled days). */
function toSchemaHours(days: DayRow[]): BusinessHourEntry[] {
  return days
    .map((row, i) => ({ day: i, start: row.start, end: row.end, enabled: row.enabled }))
    .filter((r) => r.enabled)
    .map(({ day, start, end }) => ({ day, start, end }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component for editing agenda settings.
 *
 * Design System Salvia:
 *   - Card default (border, radius xl, padding space-6, shadow xs)
 *   - Sections separated by shadcn Separator
 *   - Select for durations and intervals
 *   - Checkbox + Select for business hours
 *   - Textarea for cancellation policy
 *   - Color swatches for default session color
 *   - "Salvar" Button primary with loading state
 *   - Toast success via Sonner
 *   - Mobile: padding space-4
 */
export function AgendaSettingsForm({ settings }: AgendaSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  const initialDays = toFormDays(settings.businessHours);

  const form = useForm<AgendaSettingsInput>({
    resolver: zodResolver(agendaSettingsInputSchema),
    mode: 'onBlur',
    defaultValues: {
      default_duration_minutes: settings.defaultDurationMinutes,
      interval_minutes: settings.intervalMinutes,
      business_hours: toSchemaHours(initialDays),
      cancellation_policy: settings.cancellationPolicy ?? '',
      default_color: settings.defaultColor ?? undefined,
    },
  });

  // Track day-level enabled/disabled state locally (not in the Zod schema)
  // so we can render 7 rows with checkboxes.
  const dayRows = toFormDays(form.watch('business_hours'));

  function toggleDay(dayIndex: number, enabled: boolean) {
    const current = toFormDays(form.getValues('business_hours'));
    const row = current[dayIndex];
    if (!row) return;
    row.enabled = enabled;
    form.setValue('business_hours', toSchemaHours(current), { shouldValidate: true });
  }

  function setDayTime(dayIndex: number, field: 'start' | 'end', value: string) {
    const current = toFormDays(form.getValues('business_hours'));
    const row = current[dayIndex];
    if (!row) return;
    row[field] = value;
    form.setValue('business_hours', toSchemaHours(current), { shouldValidate: true });
  }

  function handleSubmit(data: AgendaSettingsInput) {
    startTransition(async () => {
      const result = await saveAgendaSettings(data);

      if (result.ok) {
        toast.success('Configurações salvas');
      } else if (result.error === 'invalid_input' && result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const msg = messages[0] ?? 'Campo inválido.';
          form.setError(field as keyof AgendaSettingsInput, { message: msg });
        }
      } else {
        const message = 'message' in result ? result.message : 'Erro inesperado. Tente novamente.';
        toast.error(message);
      }
    });
  }

  const selectedColor = form.watch('default_color');

  // Validate at least 1 day is enabled
  const enabledCount = dayRows.filter((d) => d.enabled).length;

  return (
    <Card data-testid="agenda-settings-card">
      <CardContent className="p-4 md:p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit(handleSubmit)();
          }}
          className="space-y-6"
          noValidate
          data-testid="agenda-settings-form"
        >
          {/* ---- Default session duration ---- */}
          <div className="space-y-2">
            <Label htmlFor="default-duration" className="text-[15px] font-normal">
              Duração padrão da sessão
            </Label>
            <Select
              value={String(form.watch('default_duration_minutes'))}
              onValueChange={(value) => {
                form.setValue('default_duration_minutes', Number(value), {
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger
                id="default-duration"
                aria-invalid={Boolean(form.formState.errors.default_duration_minutes)}
                data-testid="agenda-settings-duration"
              >
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((mins) => (
                  <SelectItem key={mins} value={String(mins)}>
                    {mins} minutos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.default_duration_minutes && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.default_duration_minutes.message}
              </p>
            )}
          </div>

          <Separator />

          {/* ---- Interval between sessions ---- */}
          <div className="space-y-2">
            <Label htmlFor="interval" className="text-[15px] font-normal">
              Intervalo entre sessões
            </Label>
            <Select
              value={String(form.watch('interval_minutes'))}
              onValueChange={(value) => {
                form.setValue('interval_minutes', Number(value), {
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger
                id="interval"
                aria-invalid={Boolean(form.formState.errors.interval_minutes)}
                data-testid="agenda-settings-interval"
              >
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((mins) => (
                  <SelectItem key={mins} value={String(mins)}>
                    {mins} minutos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.interval_minutes && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.interval_minutes.message}
              </p>
            )}
          </div>

          <Separator />

          {/* ---- Business hours ---- */}
          <div className="space-y-3">
            <Label className="text-[15px] font-normal">Horário de funcionamento</Label>

            <div className="space-y-3" role="group" aria-label="Horário de funcionamento">
              {dayRows.map((row, dayIndex) => (
                <div
                  key={dayIndex}
                  className={`flex items-center gap-3 ${!row.enabled ? 'opacity-50' : ''}`}
                  data-testid={`business-hours-day-${dayIndex}`}
                >
                  <Checkbox
                    id={`day-${dayIndex}-enabled`}
                    checked={row.enabled}
                    onCheckedChange={(checked) => toggleDay(dayIndex, checked === true)}
                    aria-label={`Habilitar ${DAY_LABELS[dayIndex]}`}
                    data-testid={`day-${dayIndex}-checkbox`}
                  />

                  <span className="w-20 shrink-0 text-[15px] font-normal">
                    {DAY_LABELS[dayIndex]}
                  </span>

                  <Select
                    value={row.start}
                    onValueChange={(value) => setDayTime(dayIndex, 'start', value)}
                    disabled={!row.enabled}
                  >
                    <SelectTrigger
                      className="w-28"
                      aria-label={`Horário início ${DAY_LABELS[dayIndex]}`}
                      data-testid={`day-${dayIndex}-start`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((slot) => (
                        <SelectItem key={slot} value={slot}>
                          {slot}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <span className="text-text-tertiary text-sm">até</span>

                  <Select
                    value={row.end}
                    onValueChange={(value) => setDayTime(dayIndex, 'end', value)}
                    disabled={!row.enabled}
                  >
                    <SelectTrigger
                      className="w-28"
                      aria-label={`Horário fim ${DAY_LABELS[dayIndex]}`}
                      data-testid={`day-${dayIndex}-end`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((slot) => (
                        <SelectItem key={slot} value={slot}>
                          {slot}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {enabledCount === 0 && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Selecione pelo menos 1 dia de funcionamento.
              </p>
            )}

            {form.formState.errors.business_hours && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {typeof form.formState.errors.business_hours.message === 'string'
                  ? form.formState.errors.business_hours.message
                  : 'Verifique os horários de funcionamento.'}
              </p>
            )}
          </div>

          <Separator />

          {/* ---- Cancellation policy ---- */}
          <div className="space-y-2">
            <Label htmlFor="cancellation-policy" className="text-[15px] font-normal">
              Política de cancelamento
            </Label>
            <Textarea
              id="cancellation-policy"
              rows={5}
              placeholder="Descreva sua política de cancelamento..."
              aria-invalid={Boolean(form.formState.errors.cancellation_policy)}
              data-testid="agenda-settings-cancellation-policy"
              {...form.register('cancellation_policy')}
            />
            <p className="text-text-tertiary text-xs">
              Este texto será incluído no termo de consentimento
            </p>
            {form.formState.errors.cancellation_policy && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.cancellation_policy.message}
              </p>
            )}
          </div>

          <Separator />

          {/* ---- Default session color ---- */}
          <div className="space-y-2">
            <Label className="text-[15px] font-normal">Cor padrão das sessões</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Cor padrão das sessões">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  role="radio"
                  aria-checked={selectedColor === preset.value}
                  aria-label={preset.label}
                  className={`duration-fast h-8 w-8 rounded-full border-2 transition-all ${
                    selectedColor === preset.value
                      ? 'shadow-focus border-border-strong scale-110'
                      : 'border-border hover:scale-105'
                  }`}
                  style={{ backgroundColor: preset.value }}
                  onClick={() => {
                    // Toggle off if already selected (allows "no default color")
                    if (selectedColor === preset.value) {
                      form.setValue('default_color', undefined, { shouldValidate: true });
                    } else {
                      form.setValue('default_color', preset.value, { shouldValidate: true });
                    }
                  }}
                  data-testid={`agenda-color-${preset.value.replace('#', '')}`}
                />
              ))}
            </div>
          </div>

          <Separator />

          {/* ---- Footer ---- */}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={isPending || enabledCount === 0}
              data-testid="agenda-settings-save"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Salvando...
                </>
              ) : (
                'Salvar'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
