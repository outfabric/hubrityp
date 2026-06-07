'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { saveReminderSettings } from '@/app/(app)/configuracoes/lembretes/actions';
import {
  reminderSettingsSchema,
  type ReminderSettingsInput,
} from '@/modules/whatsapp/lib/reminders/reminder-settings-schema';
import type { ReminderSettingsData } from '@/modules/whatsapp/server/reminders/get-reminder-settings';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Switch } from '@/shared/ui/switch';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EARLY_REMINDER_OPTIONS = [
  { value: 'none', label: 'Não enviar', hours: null },
  { value: '48', label: '48 horas antes', hours: 48 },
  { value: '24', label: '24 horas antes', hours: 24 },
  { value: '12', label: '12 horas antes', hours: 12 },
] as const;

const FINAL_REMINDER_OPTIONS = [
  { value: 'none', label: 'Não enviar', hours: null },
  { value: '2', label: '2 horas antes', hours: 2 },
  { value: '1', label: '1 hora antes', hours: 1 },
  { value: '0.5', label: '30 minutos antes', hours: 0.5 },
] as const;

const VIDEO_LINK_OPTIONS = [
  { value: '15', label: '15 minutos antes', minutes: 15 },
  { value: '30', label: '30 minutos antes', minutes: 30 },
  { value: '60', label: '60 minutos antes', minutes: 60 },
] as const;

// ---------------------------------------------------------------------------
// Helpers — convert between DB values and RadioGroup string values
// ---------------------------------------------------------------------------

function earlyHoursToRadio(hours: number | null): string {
  if (hours === null) return 'none';
  return String(hours);
}

function radioToEarlyHours(value: string): number | null {
  if (value === 'none') return null;
  return Number(value);
}

function finalHoursToRadio(hours: number | null): string {
  if (hours === null) return 'none';
  return String(hours);
}

function radioToFinalHours(value: string): number | null {
  if (value === 'none') return null;
  return Number(value);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReminderSettingsFormProps {
  settings: ReminderSettingsData;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component for editing reminder settings.
 *
 * Design System Salvia:
 *   - Card default (border, radius xl, padding space-6, shadow xs)
 *   - Sections separated by shadcn Separator
 *   - RadioGroup for early/final reminder timing
 *   - Select for video link timing
 *   - Switch for night-send preference
 *   - "Salvar" Button primary with loading state
 *   - Toast success via Sonner
 *   - Mobile: padding space-4
 */
export function ReminderSettingsForm({ settings }: ReminderSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<ReminderSettingsInput>({
    resolver: zodResolver(reminderSettingsSchema),
    mode: 'onBlur',
    defaultValues: {
      early_reminder_hours: settings.earlyReminderHours,
      final_reminder_hours: settings.finalReminderHours,
      video_link_minutes: settings.videoLinkMinutes,
      send_during_night: settings.sendDuringNight,
    },
  });

  function handleSubmit(data: ReminderSettingsInput) {
    startTransition(async () => {
      const result = await saveReminderSettings(data);

      if (result.ok) {
        toast.success('Configurações de lembretes salvas');
      } else if (result.error === 'invalid_input' && 'fieldErrors' in result) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const msg = messages[0] ?? 'Campo inválido.';
          form.setError(field as keyof ReminderSettingsInput, { message: msg });
        }
      } else {
        toast.error('Erro inesperado. Tente novamente.');
      }
    });
  }

  return (
    <Card data-testid="reminder-settings-card">
      <CardContent className="p-4 md:p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit(handleSubmit)();
          }}
          className="space-y-6"
          noValidate
          data-testid="reminder-settings-form"
        >
          {/* ---- Section 1: Early reminder ---- */}
          <div className="space-y-2">
            <Label className="text-[15px] font-normal">Lembrete antecipado</Label>
            <RadioGroup
              value={earlyHoursToRadio(form.watch('early_reminder_hours'))}
              onValueChange={(value) => {
                form.setValue('early_reminder_hours', radioToEarlyHours(value), {
                  shouldValidate: true,
                });
              }}
              data-testid="early-reminder-radio"
            >
              {EARLY_REMINDER_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={option.value}
                    id={`early-${option.value}`}
                    data-testid={`early-reminder-${option.value}`}
                  />
                  <Label htmlFor={`early-${option.value}`} className="font-normal">
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="text-text-tertiary text-sm">
              Enviado com antecedência para o paciente confirmar presença
            </p>
          </div>

          <Separator />

          {/* ---- Section 2: Final reminder ---- */}
          <div className="space-y-2">
            <Label className="text-[15px] font-normal">Lembrete final</Label>
            <RadioGroup
              value={finalHoursToRadio(form.watch('final_reminder_hours'))}
              onValueChange={(value) => {
                form.setValue('final_reminder_hours', radioToFinalHours(value), {
                  shouldValidate: true,
                });
              }}
              data-testid="final-reminder-radio"
            >
              {FINAL_REMINDER_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={option.value}
                    id={`final-${option.value}`}
                    data-testid={`final-reminder-${option.value}`}
                  />
                  <Label htmlFor={`final-${option.value}`} className="font-normal">
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="text-text-tertiary text-sm">Último lembrete antes da sessão</p>
          </div>

          <Separator />

          {/* ---- Section 3: Video link timing ---- */}
          <div className="space-y-2">
            <Label htmlFor="video-link-minutes" className="text-[15px] font-normal">
              Aviso de link de vídeo (sessões online)
            </Label>
            <Select
              value={String(form.watch('video_link_minutes'))}
              onValueChange={(value) => {
                form.setValue('video_link_minutes', Number(value), {
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger id="video-link-minutes" data-testid="video-link-select">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_LINK_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-text-tertiary text-sm">
              Envia o link da sala virtual antes da sessão online
            </p>
          </div>

          <Separator />

          {/* ---- Section 4: Send during night ---- */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                id="send-during-night"
                checked={form.watch('send_during_night')}
                onCheckedChange={(checked) => {
                  form.setValue('send_during_night', checked, {
                    shouldValidate: true,
                  });
                }}
                data-testid="send-during-night-switch"
              />
              <Label htmlFor="send-during-night" className="text-[15px] font-normal">
                Enviar de madrugada (00h-07h)
              </Label>
            </div>
            <p className="text-text-tertiary text-sm">
              Por padrão, lembretes que cairiam entre 22h e 7h são enviados às 7h da manhã
            </p>
          </div>

          <Separator />

          {/* ---- Footer ---- */}
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending} data-testid="reminder-settings-save">
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
