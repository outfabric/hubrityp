'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock } from 'lucide-react';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import type {
  NotificationPreferencesView,
  UpdateNotificationPreferencesInput,
} from '@/modules/notifications';
// The Zod schema is a runtime VALUE — import it from the pure `lib` leaf, NOT
// the module barrel. The barrel re-exports server-only read actions (which pull
// `db`/`postgres`), so importing this value through it would drag the entire
// server graph into the client bundle and break `next build`.
import { updateNotificationPreferencesInputSchema } from '@/modules/notifications/lib/preferences-schema';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';
import { Switch } from '@/shared/ui/switch';

import { updateNotificationPreferences } from './actions';

interface NotificationPreferencesFormProps {
  preferences: NotificationPreferencesView;
}

/**
 * Client leaf for editing notification preferences.
 *
 * The form only owns the three USER-EDITABLE toggles (`emailDaily`,
 * `emailWeekly`, `inAppSound`) — the exact contract of the Server Action's Zod
 * schema. `email_critical` is rendered as a locked, always-on switch: it is NOT
 * part of the form state and cannot be submitted, mirroring the server's
 * non-disableable enforcement. Even if a client tampered with the request, the
 * server coerces `email_critical` to TRUE.
 *
 * Design System Sálvia:
 *   - Card default (border, radius xl, padding space-6, shadow xs)
 *   - Sections separated by shadcn Separator
 *   - Switch for each toggle, with Label + helper copy
 *   - "Salvar" primary Button with loading state
 *   - Toast success/error via Sonner
 */
export function NotificationPreferencesForm({ preferences }: NotificationPreferencesFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<UpdateNotificationPreferencesInput>({
    resolver: zodResolver(updateNotificationPreferencesInputSchema),
    mode: 'onBlur',
    defaultValues: {
      emailDaily: preferences.emailDaily,
      emailWeekly: preferences.emailWeekly,
      inAppSound: preferences.inAppSound,
    },
  });

  function handleSubmit(data: UpdateNotificationPreferencesInput) {
    startTransition(async () => {
      const result = await updateNotificationPreferences(data);

      if (result.ok) {
        toast.success('Preferências salvas');
        // Re-sync the form to the server-persisted view (e.g., email_critical
        // stays locked on regardless of any tampering).
        form.reset({
          emailDaily: result.preferences.emailDaily,
          emailWeekly: result.preferences.emailWeekly,
          inAppSound: result.preferences.inAppSound,
        });
      } else if (result.code === 'INVALID_INPUT') {
        toast.error('Dados inválidos. Verifique e tente novamente.');
      } else if (result.code === 'UNAUTHORIZED') {
        toast.error('Sua sessão expirou. Entre novamente.');
      } else {
        toast.error('Erro inesperado. Tente novamente.');
      }
    });
  }

  return (
    <Card data-testid="notification-preferences-card">
      <CardContent className="p-4 md:p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit(handleSubmit)();
          }}
          className="space-y-6"
          noValidate
          data-testid="notification-preferences-form"
        >
          {/* ---- Daily email digest ---- */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="email-daily" className="text-[15px] font-normal">
                Resumo diário por e-mail
              </Label>
              <p className="text-text-tertiary text-xs">
                Receba um resumo das suas sessões e pendências todos os dias.
              </p>
            </div>
            <Switch
              id="email-daily"
              checked={form.watch('emailDaily')}
              onCheckedChange={(checked) =>
                form.setValue('emailDaily', checked, { shouldDirty: true })
              }
              aria-label="Resumo diário por e-mail"
              data-testid="notification-email-daily"
            />
          </div>

          <Separator />

          {/* ---- Weekly email digest ---- */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="email-weekly" className="text-[15px] font-normal">
                Resumo semanal por e-mail
              </Label>
              <p className="text-text-tertiary text-xs">
                Receba um panorama da sua semana toda segunda-feira.
              </p>
            </div>
            <Switch
              id="email-weekly"
              checked={form.watch('emailWeekly')}
              onCheckedChange={(checked) =>
                form.setValue('emailWeekly', checked, { shouldDirty: true })
              }
              aria-label="Resumo semanal por e-mail"
              data-testid="notification-email-weekly"
            />
          </div>

          <Separator />

          {/* ---- In-app sound ---- */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="in-app-sound" className="text-[15px] font-normal">
                Som das notificações no app
              </Label>
              <p className="text-text-tertiary text-xs">
                Tocar um som quando uma nova notificação chegar.
              </p>
            </div>
            <Switch
              id="in-app-sound"
              checked={form.watch('inAppSound')}
              onCheckedChange={(checked) =>
                form.setValue('inAppSound', checked, { shouldDirty: true })
              }
              aria-label="Som das notificações no app"
              data-testid="notification-in-app-sound"
            />
          </div>

          <Separator />

          {/* ---- Critical email (locked on, non-disableable) ---- */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label
                htmlFor="email-critical"
                className="text-text-secondary flex items-center gap-1.5 text-[15px] font-normal"
              >
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                E-mails críticos
              </Label>
              <p className="text-text-tertiary text-xs">
                Avisos de segurança, cobrança e conformidade são sempre enviados e não podem ser
                desativados.
              </p>
            </div>
            <Switch
              id="email-critical"
              checked
              disabled
              aria-label="E-mails críticos (sempre ativos)"
              aria-readonly="true"
              data-testid="notification-email-critical"
            />
          </div>

          <Separator />

          {/* ---- Footer ---- */}
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending} data-testid="notification-preferences-save">
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
