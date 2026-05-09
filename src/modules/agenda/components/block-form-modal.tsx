'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertCircle, Calendar as CalendarIcon, Loader2, Lock } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import { toSaoPauloTime } from '@/modules/agenda/lib/date-helpers';
import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

/**
 * Form-level input type. Uses `z.input` (not `z.infer`) because the form
 * fields produce the pre-transform shape. This aligns with how `zodResolver`
 * types the resolver generic.
 */
type BlockFormValues = z.input<typeof sessionInputSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DURATION_OPTIONS = [30, 45, 60, 90, 120] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generates 30-min time slots between `startHour` and `endHour`. */
function generateTimeSlots(startHour = 6, endHour = 22): string[] {
  const slots: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    if (h < endHour) {
      slots.push(`${String(h).padStart(2, '0')}:30`);
    }
  }
  return slots;
}

/** Calculates end time string from start time + duration. */
function computeEndTime(startTime: string, durationMinutes: number): string {
  if (!startTime) return '--:--';

  const [hours, minutes] = startTime.split(':').map(Number);
  if (hours === undefined || minutes === undefined) return '--:--';

  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endH = Math.floor(totalMinutes / 60);
  const endM = totalMinutes % 60;

  if (endH >= 24) return '--:--';
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/** Builds an ISO 8601 datetime string from a date and a time slot (HH:mm). */
function buildIsoDatetime(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const dt = new Date(date);
  dt.setHours(h ?? 0, m ?? 0, 0, 0);
  return dt.toISOString();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data shape for editing an existing blocking slot. */
export interface BlockEditData {
  id: string;
  blockingTitle: string | null;
  startAt: Date;
  durationMinutes: number;
}

interface BlockFormModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** Block data for editing. `null` = create mode. */
  block: BlockEditData | null;
  /** Pre-selected date (from calendar dateClick). */
  preselectedDate?: Date;
  /** Pre-selected time (from calendar dateClick, e.g. "14:00"). */
  preselectedTime?: string;
  /** Server Action: create session (used for blocking slots). */
  onCreate: (input: unknown) => Promise<{
    ok: boolean;
    sessionId?: string;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    message?: string;
  }>;
  /** Server Action: update session (used for blocking slots). */
  onUpdate: (
    id: string,
    input: unknown,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    message?: string;
  }>;
  /** Called after a successful create/update. */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal for creating or editing a time block (blocking slot).
 *
 * Design System Salvia:
 *   - Dialog max-width 480px, radius 2xl, padding space-8
 *   - Title h3 "Bloquear horario", 18px/600
 *   - Fields: Titulo (required), Data (Popover + Calendar), Hora inicio (Select),
 *     Duracao (Select), Hora fim (auto-calc caption)
 *   - Footer: "Bloquear" Button primary with Lock icon, "Cancelar" Button secondary
 */
export function BlockFormModal({
  open,
  onOpenChange,
  block,
  preselectedDate,
  preselectedTime,
  onCreate,
  onUpdate,
  onSuccess,
}: BlockFormModalProps) {
  const isEdit = block !== null;
  const [isPending, startTransition] = useTransition();

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('08:00');
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  const timeSlots = generateTimeSlots();

  const form = useForm<BlockFormValues>({
    resolver: zodResolver(sessionInputSchema),
    mode: 'onBlur',
    defaultValues: {
      is_blocking: true,
      blocking_title: '',
      start_at: '',
      duration_minutes: 60,
      force_conflict: true,
    },
  });

  const durationMinutes = form.watch('duration_minutes');
  const endTimeDisplay = computeEndTime(selectedTime, durationMinutes);

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;

    if (block) {
      // Edit mode
      const spDate = toSaoPauloTime(block.startAt);
      const timeStr = format(spDate, 'HH:mm');

      setSelectedDate(block.startAt);
      setSelectedTime(timeStr);

      form.reset({
        is_blocking: true,
        blocking_title: block.blockingTitle ?? '',
        start_at: block.startAt.toISOString(),
        duration_minutes: block.durationMinutes,
        force_conflict: true,
      });
    } else {
      // Create mode
      const initialDate = preselectedDate ?? new Date();
      const initialTime = preselectedTime ?? '08:00';

      setSelectedDate(initialDate);
      setSelectedTime(initialTime);

      form.reset({
        is_blocking: true,
        blocking_title: '',
        start_at: buildIsoDatetime(initialDate, initialTime),
        duration_minutes: 60,
        force_conflict: true,
      });
    }
  }, [open, block, preselectedDate, preselectedTime, form]);

  // Sync start_at when date or time changes
  useEffect(() => {
    if (selectedDate && selectedTime) {
      form.setValue('start_at', buildIsoDatetime(selectedDate, selectedTime), {
        shouldValidate: false,
      });
    }
  }, [selectedDate, selectedTime, form]);

  function handleSubmit(data: BlockFormValues) {
    startTransition(async () => {
      const result = block ? await onUpdate(block.id, data) : await onCreate(data);

      if (result.ok) {
        toast.success(
          isEdit ? 'Bloqueio atualizado com sucesso.' : 'Horario bloqueado com sucesso.',
        );
        onOpenChange(false);
        onSuccess();
      } else if (result.error === 'invalid_input' && result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const msg = messages[0] ?? 'Campo invalido.';
          form.setError(field as keyof BlockFormValues, { message: msg });
        }
      } else {
        toast.error(result.message ?? 'Erro inesperado. Tente novamente.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="block-form-modal">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar bloqueio' : 'Bloquear horario'}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit
              ? 'Edite os dados do bloqueio de horario.'
              : 'Preencha os dados para bloquear um horario na agenda.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit(handleSubmit)();
          }}
          className="space-y-4"
          noValidate
          data-testid="block-form"
        >
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="block-title">
              Titulo
              <span className="text-danger-500 ml-0.5">*</span>
            </Label>
            <Input
              id="block-title"
              placeholder="Ex: Almoco, Supervisao"
              aria-invalid={Boolean(form.formState.errors.blocking_title)}
              data-testid="block-form-title"
              {...form.register('blocking_title')}
            />
            {form.formState.errors.blocking_title && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.blocking_title.message}
              </p>
            )}
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label>
              <span className="flex items-center gap-1.5">
                <CalendarIcon className="h-4 w-4" aria-hidden="true" />
                Data
                <span className="text-danger-500">*</span>
              </span>
            </Label>
            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-start text-left font-normal"
                  data-testid="block-form-date-trigger"
                >
                  {selectedDate
                    ? format(selectedDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR })
                    : 'Selecione uma data'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate ?? undefined}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedDate(date);
                      setDatePopoverOpen(false);
                    }
                  }}
                  locale={ptBR}
                  data-testid="block-form-calendar"
                />
              </PopoverContent>
            </Popover>
            {form.formState.errors.start_at && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.start_at.message}
              </p>
            )}
          </div>

          {/* Start time + Duration (side by side) */}
          <div className="grid grid-cols-2 gap-4">
            {/* Start time */}
            <div className="space-y-2">
              <Label htmlFor="block-start-time">Hora inicio</Label>
              <Select value={selectedTime} onValueChange={(val) => setSelectedTime(val)}>
                <SelectTrigger id="block-start-time" data-testid="block-form-start-time">
                  <SelectValue placeholder="Horario" />
                </SelectTrigger>
                <SelectContent>
                  {timeSlots.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <Label htmlFor="block-duration">Duracao</Label>
              <Select
                value={String(durationMinutes)}
                onValueChange={(val) =>
                  form.setValue('duration_minutes', Number(val), { shouldValidate: true })
                }
              >
                <SelectTrigger
                  id="block-duration"
                  aria-invalid={Boolean(form.formState.errors.duration_minutes)}
                  data-testid="block-form-duration"
                >
                  <SelectValue placeholder="Duracao" />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((mins) => (
                    <SelectItem key={mins} value={String(mins)}>
                      {mins} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.duration_minutes && (
                <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {form.formState.errors.duration_minutes.message}
                </p>
              )}
            </div>
          </div>

          {/* End time (computed, read-only) */}
          <p className="text-text-tertiary text-xs" data-testid="block-form-end-time">
            Hora fim: {endTimeDisplay}
          </p>

          {/* Footer */}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="block-form-cancel"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending} data-testid="block-form-save">
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Bloqueando...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  Bloquear
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
