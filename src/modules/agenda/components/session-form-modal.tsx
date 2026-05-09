'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar as CalendarIcon,
  Loader2,
  Search,
  User,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import type { ConflictResult } from '@/modules/agenda';
import { formatSessionTime, sessionInputSchema, toSaoPauloTime } from '@/modules/agenda';
import { Alert, AlertDescription } from '@/shared/ui/alert';
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
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Form-level input type. Uses `z.input` (not `z.infer`) because the form
 * fields produce the pre-transform shape (e.g. `is_blocking` can be
 * `undefined` before the `.default(false)` kicks in). This aligns with how
 * `zodResolver` types the resolver generic.
 */
type SessionFormValues = z.input<typeof sessionInputSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DURATION_OPTIONS = [30, 40, 45, 50, 60, 90, 120] as const;

const PRESET_COLORS = [
  { label: 'Verde', value: '#6b8a66' },
  { label: 'Azul', value: '#5b7a93' },
  { label: 'Roxo', value: '#7b6b93' },
  { label: 'Rosa', value: '#b0594b' },
  { label: 'Laranja', value: '#c28a3d' },
  { label: 'Amarelo', value: '#8c6128' },
] as const;

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

/** Calculates end time string from date + start time + duration. */
function computeEndTime(date: Date | null, startTime: string, durationMinutes: number): string {
  if (!date || !startTime) return '--:--';

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

interface PatientOption {
  id: string;
  fullName: string;
}

interface LocationOption {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

/** Data shape for editing an existing session. */
export interface SessionEditData {
  id: string;
  patientId: string | null;
  patientName: string | null;
  isBlocking: boolean;
  blockingTitle: string | null;
  startAt: Date;
  durationMinutes: number;
  locationId: string | null;
  modality: string | null;
  amount: string | null;
  notes: string | null;
  color: string | null;
}

interface SessionFormModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** Session data for editing. `null` = create mode. */
  session: SessionEditData | null;
  /** Available locations. */
  locations: LocationOption[];
  /** Default duration from agenda settings. */
  defaultDurationMinutes: number;
  /** Pre-selected date (from calendar dateClick). */
  preselectedDate?: Date;
  /** Pre-selected time (from calendar dateClick, e.g. "14:00"). */
  preselectedTime?: string;
  /** Server Action: create session. */
  onCreate: (input: unknown) => Promise<{
    ok: boolean;
    sessionId?: string;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    message?: string;
    conflicts?: ConflictResult[];
  }>;
  /** Server Action: update session. */
  onUpdate: (
    id: string,
    input: unknown,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    message?: string;
    conflicts?: ConflictResult[];
  }>;
  /** Server Action: search patients by name. */
  onSearchPatients: (
    query: string,
  ) => Promise<{ ok: true; patients: PatientOption[] } | { ok: false }>;
  /** Called after a successful create/update. */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Patient Combobox (search input + dropdown)
// ---------------------------------------------------------------------------

interface PatientComboboxProps {
  value: string | undefined;
  patientName: string | null;
  onSelect: (patient: PatientOption) => void;
  onSearch: (query: string) => Promise<{ ok: true; patients: PatientOption[] } | { ok: false }>;
  error?: string;
}

function PatientCombobox({ value, patientName, onSelect, onSearch, error }: PatientComboboxProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PatientOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Display selected patient name or search query
  const displayValue = value && patientName && !isOpen ? patientName : searchQuery;

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (query.trim().length < 2) {
        setResults([]);
        return;
      }

      debounceRef.current = setTimeout(() => {
        setIsSearching(true);
        void onSearch(query).then((result) => {
          setIsSearching(false);
          if (result.ok) {
            setResults(result.patients);
          }
        });
      }, 300);
    },
    [onSearch],
  );

  const handleSelect = useCallback(
    (patient: PatientOption) => {
      onSelect(patient);
      setSearchQuery(patient.fullName);
      setIsOpen(false);
    },
    [onSelect],
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search
          className="text-text-tertiary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          value={displayValue}
          placeholder="Buscar paciente..."
          className="pl-9"
          aria-invalid={Boolean(error)}
          aria-label="Buscar paciente"
          data-testid="session-form-patient-search"
          onFocus={() => {
            setIsOpen(true);
            if (value && patientName) {
              setSearchQuery(patientName);
            }
          }}
          onChange={(e) => {
            handleSearch(e.target.value);
            setIsOpen(true);
          }}
        />
      </div>

      {isOpen && (searchQuery.trim().length >= 2 || results.length > 0) && (
        <div
          className="border-border bg-surface absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border shadow-md"
          role="listbox"
          aria-label="Resultados de pacientes"
          data-testid="session-form-patient-results"
        >
          {isSearching && (
            <div className="text-text-tertiary flex items-center gap-2 p-3 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Buscando...
            </div>
          )}

          {!isSearching && results.length === 0 && searchQuery.trim().length >= 2 && (
            <div className="text-text-tertiary p-3 text-sm">Nenhum paciente encontrado.</div>
          )}

          {!isSearching &&
            results.map((patient) => (
              <button
                key={patient.id}
                type="button"
                role="option"
                aria-selected={patient.id === value}
                className={`hover:bg-surface-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  patient.id === value ? 'bg-brand-50 text-brand-700' : 'text-text-primary'
                }`}
                onClick={() => handleSelect(patient)}
                data-testid={`patient-option-${patient.id}`}
              >
                <User className="h-4 w-4 shrink-0" aria-hidden="true" />
                {patient.fullName}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal for creating or editing a session.
 *
 * Design System Salvia:
 *   - Dialog max-width 640px, radius 2xl, padding space-8
 *   - Title h3 "Agendar sessao" (create) or "Editar sessao" (edit), 18px/600
 *   - React Hook Form + Zod (sessionInputSchema)
 *   - Conflict warning: Alert variant warning with "Agendar mesmo assim" button
 *   - Footer: "Salvar" Button primary (loading), "Cancelar" Button secondary
 *   - Mobile: full-screen Sheet slide-up (handled via Dialog responsive)
 */
export function SessionFormModal({
  open,
  onOpenChange,
  session,
  locations,
  defaultDurationMinutes,
  preselectedDate,
  preselectedTime,
  onCreate,
  onUpdate,
  onSearchPatients,
  onSuccess,
}: SessionFormModalProps) {
  const isEdit = session !== null;
  const [isPending, startTransition] = useTransition();
  const [conflicts, setConflicts] = useState<ConflictResult[]>([]);
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);

  // Derive initial values
  const defaultLocationId = locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? undefined;

  // Local state for date/time decomposition (separate from the ISO string in form)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('08:00');
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  const timeSlots = generateTimeSlots();

  const form = useForm<SessionFormValues>({
    resolver: zodResolver(sessionInputSchema),
    mode: 'onBlur',
    defaultValues: {
      patient_id: undefined,
      is_blocking: false,
      start_at: '',
      duration_minutes: defaultDurationMinutes,
      location_id: defaultLocationId,
      modality: 'in_person',
      amount: undefined,
      notes: '',
      color: undefined,
      force_conflict: false,
    },
  });

  const durationMinutes = form.watch('duration_minutes');
  const endTimeDisplay = computeEndTime(selectedDate, selectedTime, durationMinutes);
  const selectedColor = form.watch('color');

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;

    setConflicts([]);

    if (session) {
      // Edit mode: populate from session data
      const spDate = toSaoPauloTime(session.startAt);
      const timeStr = format(spDate, 'HH:mm');

      setSelectedDate(session.startAt);
      setSelectedTime(timeStr);
      setSelectedPatientName(session.patientName);

      form.reset({
        patient_id: session.patientId ?? undefined,
        is_blocking: session.isBlocking,
        blocking_title: session.blockingTitle ?? undefined,
        start_at: session.startAt.toISOString(),
        duration_minutes: session.durationMinutes,
        location_id: session.locationId ?? defaultLocationId,
        modality: (session.modality as 'in_person' | 'online') ?? 'in_person',
        amount: session.amount ?? undefined,
        notes: session.notes ?? '',
        color: session.color ?? undefined,
        force_conflict: false,
      });
    } else {
      // Create mode
      const initialDate = preselectedDate ?? new Date();
      const initialTime = preselectedTime ?? '08:00';

      setSelectedDate(initialDate);
      setSelectedTime(initialTime);
      setSelectedPatientName(null);

      form.reset({
        patient_id: undefined,
        is_blocking: false,
        start_at: buildIsoDatetime(initialDate, initialTime),
        duration_minutes: defaultDurationMinutes,
        location_id: defaultLocationId,
        modality: 'in_person',
        amount: undefined,
        notes: '',
        color: undefined,
        force_conflict: false,
      });
    }
  }, [
    open,
    session,
    preselectedDate,
    preselectedTime,
    defaultDurationMinutes,
    defaultLocationId,
    form,
  ]);

  // Sync start_at when date or time changes
  useEffect(() => {
    if (selectedDate && selectedTime) {
      form.setValue('start_at', buildIsoDatetime(selectedDate, selectedTime), {
        shouldValidate: false,
      });
    }
  }, [selectedDate, selectedTime, form]);

  function handlePatientSelect(patient: PatientOption) {
    setSelectedPatientName(patient.fullName);
    form.setValue('patient_id', patient.id, { shouldValidate: true });
  }

  function handleForceConflict() {
    form.setValue('force_conflict', true);
    void form.handleSubmit(handleSubmit)();
  }

  function handleSubmit(data: SessionFormValues) {
    startTransition(async () => {
      const result = session ? await onUpdate(session.id, data) : await onCreate(data);

      if (result.ok) {
        toast.success(isEdit ? 'Sessao atualizada com sucesso.' : 'Sessao agendada com sucesso.');
        onOpenChange(false);
        onSuccess();
      } else if (result.error === 'conflict_warning' && result.conflicts) {
        setConflicts(result.conflicts);
        form.setValue('force_conflict', false);
      } else if (result.error === 'invalid_input' && result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const msg = messages[0] ?? 'Campo invalido.';
          form.setError(field as keyof SessionFormValues, { message: msg });
        }
      } else {
        toast.error(result.message ?? 'Erro inesperado. Tente novamente.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]" data-testid="session-form-modal">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar sessao' : 'Agendar sessao'}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit
              ? 'Edite os dados da sessao.'
              : 'Preencha os dados para agendar uma nova sessao.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConflicts([]);
            void form.handleSubmit(handleSubmit)();
          }}
          className="space-y-4"
          noValidate
          data-testid="session-form"
        >
          {/* Patient (hidden when is_blocking) */}
          <div className="space-y-2">
            <Label>
              <span className="flex items-center gap-1.5">
                <User className="h-4 w-4" aria-hidden="true" />
                Paciente
                <span className="text-danger-500">*</span>
              </span>
            </Label>
            <PatientCombobox
              value={form.watch('patient_id')}
              patientName={selectedPatientName}
              onSelect={handlePatientSelect}
              onSearch={onSearchPatients}
              error={form.formState.errors.patient_id?.message}
            />
            {form.formState.errors.patient_id && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.patient_id.message}
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
                  data-testid="session-form-date-trigger"
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
                  data-testid="session-form-calendar"
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
              <Label htmlFor="session-start-time">Hora inicio</Label>
              <Select value={selectedTime} onValueChange={(val) => setSelectedTime(val)}>
                <SelectTrigger id="session-start-time" data-testid="session-form-start-time">
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
              <Label htmlFor="session-duration">Duracao</Label>
              <Select
                value={String(durationMinutes)}
                onValueChange={(val) =>
                  form.setValue('duration_minutes', Number(val), { shouldValidate: true })
                }
              >
                <SelectTrigger
                  id="session-duration"
                  aria-invalid={Boolean(form.formState.errors.duration_minutes)}
                  data-testid="session-form-duration"
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
          <p className="text-text-tertiary text-xs" data-testid="session-form-end-time">
            Hora fim: {endTimeDisplay}
          </p>

          {/* Location */}
          {locations.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="session-location">Local</Label>
              <Select
                value={form.watch('location_id') ?? ''}
                onValueChange={(val) =>
                  form.setValue('location_id', val || undefined, { shouldValidate: true })
                }
              >
                <SelectTrigger id="session-location" data-testid="session-form-location">
                  <SelectValue placeholder="Selecione um local" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Modality */}
          <div className="space-y-2">
            <Label>Modalidade</Label>
            <RadioGroup
              value={form.watch('modality') ?? 'in_person'}
              onValueChange={(val) =>
                form.setValue('modality', val as 'in_person' | 'online', {
                  shouldValidate: true,
                })
              }
              className="flex gap-4"
              data-testid="session-form-modality"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="in_person" id="modality-in-person" />
                <Label
                  htmlFor="modality-in-person"
                  className="flex cursor-pointer items-center gap-1.5 font-normal"
                >
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                  Presencial
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="online" id="modality-online" />
                <Label
                  htmlFor="modality-online"
                  className="flex cursor-pointer items-center gap-1.5 font-normal"
                >
                  <Video className="h-4 w-4" aria-hidden="true" />
                  Online
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="session-amount">Valor</Label>
            <div className="relative">
              <span className="text-text-tertiary absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                R$
              </span>
              <Input
                id="session-amount"
                type="text"
                inputMode="decimal"
                className="pl-10"
                placeholder="0,00"
                aria-invalid={Boolean(form.formState.errors.amount)}
                data-testid="session-form-amount"
                {...form.register('amount')}
              />
            </div>
            {form.formState.errors.amount && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.amount.message}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="session-notes">Observacao</Label>
            <Textarea
              id="session-notes"
              rows={3}
              placeholder="Observacoes sobre a sessao (opcional)"
              aria-invalid={Boolean(form.formState.errors.notes)}
              data-testid="session-form-notes"
              {...form.register('notes')}
            />
            {form.formState.errors.notes && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.notes.message}
              </p>
            )}
          </div>

          {/* Color */}
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Cor da sessao">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  role="radio"
                  aria-checked={selectedColor === preset.value}
                  aria-label={preset.label}
                  className={`duration-fast h-8 w-8 rounded-full border-2 transition-all ${
                    selectedColor === preset.value
                      ? 'border-brand-500 scale-110'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: preset.value }}
                  onClick={() => {
                    if (selectedColor === preset.value) {
                      form.setValue('color', undefined, { shouldValidate: true });
                    } else {
                      form.setValue('color', preset.value, { shouldValidate: true });
                    }
                  }}
                  data-testid={`session-color-${preset.value.replace('#', '')}`}
                />
              ))}
            </div>
          </div>

          {/* Conflict Warning */}
          {conflicts.length > 0 && (
            <Alert variant="warning" data-testid="session-form-conflict-alert">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  {conflicts.map((c) => (
                    <p key={c.sessionId}>
                      Voce ja tem {c.label} das{' '}
                      {formatSessionTime(toSaoPauloTime(new Date(c.conflictStart)))} as{' '}
                      {formatSessionTime(toSaoPauloTime(new Date(c.conflictEnd)))} nesse horario.
                    </p>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleForceConflict}
                    disabled={isPending}
                    data-testid="session-form-force-conflict"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Agendando...
                      </>
                    ) : (
                      'Agendar mesmo assim'
                    )}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Footer */}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="session-form-cancel"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending} data-testid="session-form-save">
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Salvando...
                </>
              ) : (
                'Salvar'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
