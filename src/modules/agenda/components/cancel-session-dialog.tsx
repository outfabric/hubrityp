'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  calculateCancellationNotice,
  type CancellationNotice,
} from '@/modules/agenda/lib/cancellation-notice';
import {
  cancelSessionInputSchema,
  type CancelSessionInput,
} from '@/modules/agenda/lib/cancellation-schema';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REASON_OPTIONS = [
  { value: 'patient_cancelled', label: 'Paciente cancelou' },
  { value: 'therapist_cancelled', label: 'Psicólogo cancelou' },
  { value: 'unforeseen', label: 'Imprevisto' },
  { value: 'other', label: 'Outro' },
] as const;

const CANCELLED_BY_OPTIONS = [
  { value: 'patient', label: 'Paciente' },
  { value: 'therapist', label: 'Psicólogo' },
] as const;

const NOTICE_VARIANT: Record<CancellationNotice, 'info' | 'warning' | 'danger'> = {
  '24h+': 'info',
  less_24h: 'warning',
  less_1h: 'warning',
  on_time: 'danger',
};

const NOTICE_LABEL: Record<CancellationNotice, string> = {
  '24h+': 'Cancelamento com mais de 24h de antecedência.',
  less_24h: 'Cancelamento com menos de 24h de antecedência.',
  less_1h: 'Cancelamento com menos de 1h de antecedência.',
  on_time: 'Cancelamento no horário da sessão ou após o início.',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CancelSessionDialogProps {
  /** Session ID to cancel. */
  sessionId: string;
  /** Session start time — used to calculate cancellation notice tier. */
  sessionStartAt: Date;
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** Server Action to cancel the session. */
  onConfirm: (
    input: CancelSessionInput,
  ) => Promise<{ ok: boolean; error?: string; message?: string; rescheduleData?: unknown }>;
  /** Called after a successful cancellation (e.g., to refresh sessions). */
  onSuccess: () => void;
  /** If true, on success opens session creation modal pre-filled (reschedule). */
  isReschedule?: boolean;
  /** Called with reschedule data when reschedule mode + success. */
  onRescheduleReady?: (data: unknown) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Cancellation dialog for a session.
 *
 * Design System Salvia:
 *   - Dialog max-width 480px, radius 2xl, padding space-8 desktop / space-6 mobile
 *   - Title h3 "Cancelar sessao" (18px/600)
 *   - Select for reason, RadioGroup for "Quem cancelou"
 *   - Alert with calculated notice (info/warning/danger)
 *   - Switch for "Aplicar cobranca?"
 *   - Footer: "Cancelar sessao" Button danger + loading, "Voltar" Button secondary
 *   - Form validated with React Hook Form + cancelSessionInputSchema
 *   - On success: toast "Sessao cancelada" (Sonner, border-left danger-500)
 */
export function CancelSessionDialog({
  sessionId,
  sessionStartAt,
  open,
  onOpenChange,
  onConfirm,
  onSuccess,
  isReschedule = false,
  onRescheduleReady,
}: CancelSessionDialogProps) {
  const [isPending, startTransition] = useTransition();

  // Use empty strings instead of `undefined` to keep Radix Select and
  // RadioGroup in controlled mode from mount, avoiding React warnings about
  // switching from uncontrolled to controlled. Zod validation rejects the
  // empty string at submit time since it's not a valid enum member.
  const form = useForm<CancelSessionInput>({
    resolver: zodResolver(cancelSessionInputSchema),
    defaultValues: {
      sessionId,
      reason: '' as unknown as CancelSessionInput['reason'],
      cancelledBy: '' as unknown as CancelSessionInput['cancelledBy'],
      chargeCancellation: false,
      isReschedule,
    },
  });

  const notice = calculateCancellationNotice(sessionStartAt, new Date());
  const noticeVariant = NOTICE_VARIANT[notice];

  function handleSubmit(values: CancelSessionInput) {
    startTransition(async () => {
      const result = await onConfirm(values);

      if (result.ok) {
        toast.success('Sessão cancelada', {
          className: 'border-l-4 border-l-danger-500',
        });
        form.reset();
        onOpenChange(false);
        onSuccess();

        if (isReschedule && result.rescheduleData && onRescheduleReady) {
          onRescheduleReady(result.rescheduleData);
        }
      } else {
        toast.error(result.message ?? 'Erro ao cancelar sessão.');
      }
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      form.reset();
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="cancel-session-dialog">
        <DialogHeader>
          <DialogTitle>Cancelar sessão</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(handleSubmit)(e)}
            className="space-y-6"
            data-testid="cancel-session-form"
          >
            {/* Reason select */}
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo do cancelamento</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="cancel-reason-select">
                        <SelectValue placeholder="Selecione o motivo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {REASON_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Cancelled by radio group */}
            <FormField
              control={form.control}
              name="cancelledBy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quem cancelou?</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      data-testid="cancel-cancelled-by"
                    >
                      {CANCELLED_BY_OPTIONS.map((opt) => (
                        <div key={opt.value} className="flex items-center gap-2">
                          <RadioGroupItem value={opt.value} id={`cancelled-by-${opt.value}`} />
                          <Label htmlFor={`cancelled-by-${opt.value}`}>{opt.label}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Cancellation notice alert */}
            <Alert variant={noticeVariant} data-testid="cancel-notice-alert">
              <AlertDescription>{NOTICE_LABEL[notice]}</AlertDescription>
            </Alert>

            {/* Charge cancellation switch */}
            <FormField
              control={form.control}
              name="chargeCancellation"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="cancel-charge-switch"
                      />
                    </FormControl>
                    <FormLabel>Aplicar cobrança?</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Footer */}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
                data-testid="cancel-dialog-back"
              >
                Voltar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isPending}
                data-testid="cancel-dialog-confirm"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Cancelando...
                  </>
                ) : (
                  'Cancelar sessão'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
