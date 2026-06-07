'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

// ---------------------------------------------------------------------------
// Mobile detection hook
// ---------------------------------------------------------------------------

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(query);

    function handler(e: MediaQueryListEvent) {
      setMatches(e.matches);
    }

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const step1Schema = z.object({
  phone: z
    .string()
    .min(1, { message: 'Telefone é obrigatório.' })
    .regex(/^\+[1-9]\d{6,14}$/, {
      message: 'Telefone inválido. Use o formato +55 DD NNNNN-NNNN.',
    }),
  displayName: z
    .string()
    .min(1, { message: 'Nome de exibição é obrigatório.' })
    .max(120, { message: 'Nome de exibição deve ter no máximo 120 caracteres.' }),
  consent: z.literal(true, {
    message: 'Você precisa confirmar o consentimento LGPD para continuar.',
  }),
});

type Step1Values = z.infer<typeof step1Schema>;

const step2Schema = z.object({
  verificationCode: z
    .string()
    .regex(/^\d{6}$/, { message: 'Código de verificação deve ter 6 dígitos.' }),
});

type Step2Values = z.infer<typeof step2Schema>;

// ---------------------------------------------------------------------------
// Phone mask helper
// ---------------------------------------------------------------------------

/**
 * Applies a Brazilian phone mask: +55 DD NNNNN-NNNN
 * Strips non-digit characters (except leading +), then formats.
 */
function applyPhoneMask(value: string): string {
  // Preserve leading + if present
  const hasPlus = value.startsWith('+');
  const digits = value.replace(/\D/g, '');

  if (digits.length === 0) return hasPlus ? '+' : '';

  let result = '+';
  // Country code (up to 2 digits)
  result += digits.slice(0, 2);
  if (digits.length > 2) {
    result += ' ' + digits.slice(2, 4);
  }
  if (digits.length > 4) {
    result += ' ' + digits.slice(4, 9);
  }
  if (digits.length > 9) {
    result += '-' + digits.slice(9, 13);
  }

  return result;
}

/**
 * Strips mask characters to produce a raw E.164 string.
 */
function stripPhoneMask(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  return '+' + digits;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectWhatsappDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartConnection: (
    input: unknown,
  ) => Promise<
    | { ok: true; senderSid: string; verificationMethod: string }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]>; message?: string }
  >;
  onCompleteConnection: (
    input: unknown,
  ) => Promise<
    | { ok: true }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]>; message?: string }
  >;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectWhatsappDialog({
  open,
  onOpenChange,
  onStartConnection,
  onCompleteConnection,
  onSuccess,
}: ConnectWhatsappDialogProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [step, setStep] = useState<1 | 2>(1);
  const [senderSid, setSenderSid] = useState('');
  const [phoneForStep2, setPhoneForStep2] = useState('');
  const [displayNameForStep2, setDisplayNameForStep2] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [isStep1Pending, startStep1Transition] = useTransition();
  const [isStep2Pending, startStep2Transition] = useTransition();
  const [isResending, startResendTransition] = useTransition();

  const step1Form = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      phone: '',
      displayName: '',
      consent: undefined as unknown as true,
    },
    mode: 'onBlur',
  });

  const step2Form = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      verificationCode: '',
    },
    mode: 'onBlur',
  });

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      // Small delay to allow close animation before resetting
      const timer = setTimeout(() => {
        setStep(1);
        setSenderSid('');
        setPhoneForStep2('');
        setDisplayNameForStep2('');
        setMaskedPhone('');
        step1Form.reset();
        step2Form.reset();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open, step1Form, step2Form]);

  const handleStep1Submit = useCallback(
    (values: Step1Values) => {
      startStep1Transition(async () => {
        const result = await onStartConnection({
          phone: values.phone,
          displayName: values.displayName,
          consent: values.consent,
        });

        if (result.ok) {
          setSenderSid(result.senderSid);
          setPhoneForStep2(values.phone);
          setDisplayNameForStep2(values.displayName);
          setStep(2);
        } else {
          if (result.error === 'invalid_input' && result.fieldErrors) {
            for (const [field, messages] of Object.entries(result.fieldErrors)) {
              if (field === 'phone' || field === 'displayName' || field === 'consent') {
                step1Form.setError(field, {
                  message: messages[0],
                });
              }
            }
          } else {
            toast.error(result.message ?? 'Erro ao iniciar conexão. Tente novamente.');
          }
        }
      });
    },
    [onStartConnection, step1Form],
  );

  const handleStep2Submit = useCallback(
    (values: Step2Values) => {
      startStep2Transition(async () => {
        const result = await onCompleteConnection({
          senderSid,
          verificationCode: values.verificationCode,
          phoneNumber: phoneForStep2,
          displayName: displayNameForStep2,
        });

        if (result.ok) {
          onSuccess();
        } else {
          if (result.error === 'invalid_input' && result.fieldErrors?.verificationCode) {
            step2Form.setError('verificationCode', {
              message: result.fieldErrors.verificationCode[0],
            });
          } else {
            toast.error(result.message ?? 'Erro ao verificar código. Tente novamente.');
          }
        }
      });
    },
    [onCompleteConnection, onSuccess, senderSid, phoneForStep2, displayNameForStep2, step2Form],
  );

  const handleResendCode = useCallback(() => {
    startResendTransition(async () => {
      const result = await onStartConnection({
        phone: phoneForStep2,
        displayName: displayNameForStep2,
        consent: true,
      });

      if (result.ok) {
        setSenderSid(result.senderSid);
        toast.success('Código reenviado com sucesso.');
      } else {
        toast.error(result.message ?? 'Erro ao reenviar código. Tente novamente.');
      }
    });
  }, [onStartConnection, phoneForStep2, displayNameForStep2]);

  // Wrap handleSubmit results to avoid @typescript-eslint/no-misused-promises
  // on the <form onSubmit> attribute (which expects a void return).
  const onStep1Submit = step1Form.handleSubmit(handleStep1Submit);
  const onStep2Submit = step2Form.handleSubmit(handleStep2Submit);

  // ----- Step 1 content -----
  const step1Content = (
    <Form {...step1Form}>
      <form
        onSubmit={(e) => void onStep1Submit(e)}
        className="space-y-6"
        data-testid="connect-whatsapp-step1-form"
      >
        <FormField
          control={step1Form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telefone</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="+55 11 98765-4321"
                  value={maskedPhone}
                  onChange={(e) => {
                    const masked = applyPhoneMask(e.target.value);
                    setMaskedPhone(masked);
                    field.onChange(stripPhoneMask(masked));
                  }}
                  data-testid="connect-whatsapp-phone-input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={step1Form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome de exibição</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Dra. Maria Silva"
                  data-testid="connect-whatsapp-display-name-input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={step1Form.control}
          name="consent"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(checked) => {
                    field.onChange(checked === true ? true : undefined);
                  }}
                  data-testid="connect-whatsapp-consent-checkbox"
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel className="text-text-secondary text-[13px] font-normal">
                  Confirmo que tenho base legal para enviar lembretes de sessão aos meus pacientes
                  via WhatsApp (LGPD art. 7, II e IX)
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isStep1Pending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isStep1Pending}
            data-testid="connect-whatsapp-continue-button"
          >
            {isStep1Pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Continuar
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );

  // ----- Step 2 content -----
  const step2Content = (
    <Form {...step2Form}>
      <form
        onSubmit={(e) => void onStep2Submit(e)}
        className="space-y-6"
        data-testid="connect-whatsapp-step2-form"
      >
        <p className="text-text-secondary text-[15px]">
          Enviamos um código de verificação para o número informado.
        </p>

        <FormField
          control={step2Form.control}
          name="verificationCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Código de verificação</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  data-testid="connect-whatsapp-verification-code-input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="button"
          variant="link"
          className="text-[12px] font-medium"
          onClick={handleResendCode}
          disabled={isResending}
          data-testid="connect-whatsapp-resend-button"
        >
          {isResending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Reenviar código
        </Button>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isStep2Pending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isStep2Pending}
            data-testid="connect-whatsapp-verify-button"
          >
            {isStep2Pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Verificar e conectar
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );

  const content = step === 1 ? step1Content : step2Content;

  // Mobile: full-screen Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-full rounded-t-none p-6">
          <SheetHeader className="mb-6">
            <div className="flex items-center gap-3">
              <MessageCircle className="text-text-tertiary h-5 w-5 shrink-0" aria-hidden="true" />
              <SheetTitle>Conectar WhatsApp</SheetTitle>
            </div>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]" data-testid="connect-whatsapp-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <MessageCircle className="text-text-tertiary h-5 w-5 shrink-0" aria-hidden="true" />
            <DialogTitle>Conectar WhatsApp</DialogTitle>
          </div>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
