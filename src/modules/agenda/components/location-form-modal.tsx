'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  locationInputSchema,
  type LocationInput,
} from '@/modules/agenda/lib/location-input-schema';
import type { LocationCardData } from '@/modules/agenda/components/location-card';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Preset colors for the color picker swatches
// ---------------------------------------------------------------------------

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

const LOCATION_TYPE_LABELS: Record<string, string> = {
  in_person: 'Presencial',
  online: 'Online',
  other: 'Outro',
};

interface LocationFormModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** Location data to pre-fill for editing. `null` = create mode. */
  location: LocationCardData | null;
  /** Server Action for creating a location. */
  onCreate: (input: unknown) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    message?: string;
  }>;
  /** Server Action for updating a location. */
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
 * Modal for creating or editing a location.
 *
 * Design System Salvia:
 *   - Dialog max-width 480px, radius 2xl, padding space-8
 *   - Title h3 "Adicionar local" or "Editar local"
 *   - React Hook Form + Zod (locationInputSchema)
 *   - Fields: Nome (required), Endereco, Tipo (Select), Cor (swatches),
 *     Instrucoes de chegada (Textarea 3 rows), Padrao (Checkbox)
 *   - Gap label->input space-2, gap between fields space-4
 *   - Footer: "Salvar" Button primary (loading), "Cancelar" Button secondary
 *   - Validation inline on blur with AlertCircle in danger-700
 */
export function LocationFormModal({
  open,
  onOpenChange,
  location,
  onCreate,
  onUpdate,
  onSuccess,
}: LocationFormModalProps) {
  const isEdit = location !== null;
  const [isPending, startTransition] = useTransition();

  const form = useForm<LocationInput>({
    resolver: zodResolver(locationInputSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      address: '',
      type: 'in_person',
      color: PRESET_COLORS[0].value,
      arrival_instructions: '',
      is_default: false,
    },
  });

  // Reset form when opening with different data
  useEffect(() => {
    if (open) {
      if (location) {
        form.reset({
          name: location.name,
          address: location.address ?? '',
          type: location.type as LocationInput['type'],
          color: location.color ?? PRESET_COLORS[0].value,
          arrival_instructions: location.arrivalInstructions ?? '',
          is_default: location.isDefault,
        });
      } else {
        form.reset({
          name: '',
          address: '',
          type: 'in_person',
          color: PRESET_COLORS[0].value,
          arrival_instructions: '',
          is_default: false,
        });
      }
    }
  }, [open, location, form]);

  function handleSubmit(data: LocationInput) {
    startTransition(async () => {
      const result = isEdit ? await onUpdate(location.id, data) : await onCreate(data);

      if (result.ok) {
        toast.success(isEdit ? 'Local atualizado com sucesso.' : 'Local criado com sucesso.');
        onOpenChange(false);
        onSuccess();
      } else if (result.error === 'invalid_input' && result.fieldErrors) {
        // Map server field errors back to the form
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const msg = messages[0] ?? 'Campo invalido.';
          form.setError(field as keyof LocationInput, { message: msg });
        }
      } else {
        toast.error(result.message ?? 'Erro inesperado. Tente novamente.');
      }
    });
  }

  const selectedColor = form.watch('color');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="location-form-modal">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar local' : 'Adicionar local'}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit
              ? 'Edite as informacoes do local de atendimento.'
              : 'Preencha as informacoes do novo local de atendimento.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit(handleSubmit)();
          }}
          className="space-y-4"
          noValidate
          data-testid="location-form"
        >
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="location-name">
              Nome
              <span className="text-danger-500 ml-0.5">*</span>
            </Label>
            <Input
              id="location-name"
              placeholder="Ex: Consultorio Centro"
              aria-invalid={Boolean(form.formState.errors.name)}
              data-testid="location-form-name"
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="location-address">Endereco</Label>
            <Input
              id="location-address"
              placeholder="Rua, numero, bairro, cidade"
              aria-invalid={Boolean(form.formState.errors.address)}
              data-testid="location-form-address"
              {...form.register('address')}
            />
            {form.formState.errors.address && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.address.message}
              </p>
            )}
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="location-type">Tipo</Label>
            <Select
              value={form.watch('type')}
              onValueChange={(value) => {
                form.setValue('type', value as LocationInput['type'], {
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger
                id="location-type"
                aria-invalid={Boolean(form.formState.errors.type)}
                data-testid="location-form-type"
              >
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.type && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.type.message}
              </p>
            )}
          </div>

          {/* Color swatches */}
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Cor do local">
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
                  onClick={() => form.setValue('color', preset.value, { shouldValidate: true })}
                  data-testid={`location-color-${preset.value.replace('#', '')}`}
                />
              ))}
            </div>
          </div>

          {/* Arrival instructions */}
          <div className="space-y-2">
            <Label htmlFor="location-instructions">Instrucoes de chegada</Label>
            <Textarea
              id="location-instructions"
              placeholder="Ex: Entrar pela porta lateral, subir ao 3o andar"
              rows={3}
              aria-invalid={Boolean(form.formState.errors.arrival_instructions)}
              data-testid="location-form-instructions"
              {...form.register('arrival_instructions')}
            />
            {form.formState.errors.arrival_instructions && (
              <p className="text-danger-700 flex items-center gap-1 text-sm" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {form.formState.errors.arrival_instructions.message}
              </p>
            )}
          </div>

          {/* Is default checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="location-default"
              checked={form.watch('is_default') ?? false}
              onCheckedChange={(checked) =>
                form.setValue('is_default', checked === true, { shouldValidate: true })
              }
              data-testid="location-form-default"
            />
            <Label htmlFor="location-default" className="cursor-pointer">
              Marcar como padrao
            </Label>
          </div>

          {/* Footer */}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="location-form-cancel"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending} data-testid="location-form-save">
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
