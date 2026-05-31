'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Clock } from 'lucide-react';
import { useId, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

import { locationStepSchema, type LocationStepInput } from '../lib/wizard';

// ---------------------------------------------------------------------------
// Action result shape (mirrors the module impl's sanitized result)
// ---------------------------------------------------------------------------

export type SaveLocationStepResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' | 'unknown' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> };

export interface StepLocationProps {
  /**
   * Persists the `location` step by creating the first consultation location
   * server-side (authorized by `auth.uid()`). The client passes NO user id —
   * authorization is session-only on the server. On success the server flips
   * `onboarding_checklist.location_configured` and advances the wizard step.
   */
  onCreateLocation: (input: LocationStepInput) => Promise<SaveLocationStepResult>;
}

// The agenda defaults the wizard surfaces to the user. These mirror the
// `agenda_settings` table defaults (session duration 50 min, interval 10 min)
// — the server reuses those defaults rather than re-collecting them here.
const DEFAULT_SESSION_DURATION_MIN = 50;
const DEFAULT_SESSION_INTERVAL_MIN = 10;

// pt-BR labels for the agenda's `location_input_schema` type enum.
const LOCATION_TYPE_LABELS: Record<LocationStepInput['type'], string> = {
  in_person: 'Presencial',
  online: 'Online',
  other: 'Outro',
};

/**
 * Wizard step 2 — "Local e agenda".
 *
 * Client leaf that REUSES the agenda module's location shape
 * ({@link locationStepSchema}, an alias of the agenda `locationInputSchema`)
 * instead of inventing a parallel location form. Adding the first location
 * marks the step complete: the injected {@link StepLocationProps.onCreateLocation}
 * action creates the row through the agenda create path and the server flips the
 * `location_configured` checklist flag.
 *
 * Validation is blur-time (`mode: 'onTouched'`) with inline errors per the
 * Sálvia design system. The agenda defaults (50-min sessions, 10-min interval,
 * standard working hours) are surfaced as read-only context — the server
 * applies them via the `agenda_settings` table defaults, so the wizard does not
 * re-collect them.
 */
export function StepLocation({ onCreateLocation }: StepLocationProps) {
  const [isPending, startTransition] = useTransition();

  const ids = {
    name: useId(),
    type: useId(),
    address: useId(),
    instructions: useId(),
  } as const;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors },
  } = useForm<LocationStepInput>({
    resolver: zodResolver(locationStepSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      type: 'in_person',
      address: '',
      arrival_instructions: '',
    },
  });

  const selectedType = watch('type');

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await onCreateLocation(data);

      if (result.ok) return;

      if (result.error === 'invalid_input') {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages.length > 0) {
            setError(field as keyof LocationStepInput, { type: 'server', message: messages[0] });
          }
        }
        return;
      }

      toast.error('Não foi possível salvar o local. Tente novamente.');
    });
  });

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="flex flex-col gap-5"
      noValidate
      data-testid="step-location-form"
    >
      {/* Location name (required) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.name}>Nome do local</Label>
        <Input
          id={ids.name}
          type="text"
          placeholder="Ex: Consultório Vila Madalena"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${ids.name}-error` : undefined}
          data-testid="step-location-name"
          {...register('name')}
        />
        {errors.name?.message ? (
          <p
            id={`${ids.name}-error`}
            role="alert"
            className="text-danger-700 flex items-center gap-1 text-sm"
            data-testid="step-location-name-error"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errors.name.message}
          </p>
        ) : null}
      </div>

      {/* Location type (required) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.type}>Tipo de atendimento</Label>
        <Select
          value={selectedType}
          onValueChange={(value) =>
            setValue('type', value as LocationStepInput['type'], { shouldValidate: true })
          }
        >
          <SelectTrigger
            id={ids.type}
            aria-invalid={errors.type ? true : undefined}
            data-testid="step-location-type"
          >
            <SelectValue placeholder="Selecione..." />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LOCATION_TYPE_LABELS) as LocationStepInput['type'][]).map((value) => (
              <SelectItem key={value} value={value}>
                {LOCATION_TYPE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.type?.message ? (
          <p role="alert" className="text-danger-700 flex items-center gap-1 text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errors.type.message}
          </p>
        ) : null}
      </div>

      {/* Address (optional) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.address}>Endereço (opcional)</Label>
        <Input
          id={ids.address}
          type="text"
          placeholder="Rua, número, bairro, cidade"
          aria-invalid={errors.address ? true : undefined}
          data-testid="step-location-address"
          {...register('address')}
        />
        {errors.address?.message ? (
          <p role="alert" className="text-danger-700 flex items-center gap-1 text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errors.address.message}
          </p>
        ) : null}
      </div>

      {/* Arrival instructions (optional) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.instructions}>Instruções de chegada (opcional)</Label>
        <Textarea
          id={ids.instructions}
          rows={3}
          placeholder="Ex: Entrar pela porta lateral, subir ao 3º andar."
          aria-invalid={errors.arrival_instructions ? true : undefined}
          data-testid="step-location-instructions"
          {...register('arrival_instructions')}
        />
        {errors.arrival_instructions?.message ? (
          <p role="alert" className="text-danger-700 flex items-center gap-1 text-sm">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errors.arrival_instructions.message}
          </p>
        ) : null}
      </div>

      {/* Agenda defaults — read-only context, applied server-side */}
      <div
        className="border-border bg-surface-muted flex items-start gap-3 rounded-xl border p-4"
        data-testid="step-location-agenda-defaults"
      >
        <Clock className="text-text-tertiary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-text-primary text-sm font-medium">Padrões da agenda</p>
          <p className="text-text-secondary text-sm">
            Sessões de {DEFAULT_SESSION_DURATION_MIN} minutos, com {DEFAULT_SESSION_INTERVAL_MIN}{' '}
            minutos de intervalo e horário comercial padrão. Você poderá ajustar tudo depois em
            Configurações.
          </p>
        </div>
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={isPending}
        data-testid="step-location-submit"
        className="self-start"
      >
        {isPending ? 'Salvando...' : 'Continuar'}
      </Button>
    </form>
  );
}
