'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, Info, Loader2 } from 'lucide-react';
import { useCallback, useState, useTransition } from 'react';
import type { DateRange } from 'react-day-picker';
import { toast } from 'sonner';
import { z } from 'zod';

import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Separator } from '@/shared/ui/separator';
import { Switch } from '@/shared/ui/switch';

// ---------------------------------------------------------------------------
// Section definitions (PT-BR labels for the 7 export sections)
// ---------------------------------------------------------------------------

const SECTION_ITEMS = [
  { key: 'anamnese', label: 'Anamnese' },
  { key: 'evolucoes', label: 'Evolucoes' },
  { key: 'hipoteses', label: 'Hipoteses diagnosticas' },
  { key: 'planoTerapeutico', label: 'Plano terapeutico' },
  { key: 'escalas', label: 'Escalas' },
  { key: 'documentos', label: 'Documentos clinicos' },
  { key: 'anexosIndex', label: 'Indice de anexos' },
] as const;

type SectionKey = (typeof SECTION_ITEMS)[number]['key'];

/** All sections enabled by default. */
function defaultSections(): Record<SectionKey, boolean> {
  return {
    anamnese: true,
    evolucoes: true,
    hipoteses: true,
    planoTerapeutico: true,
    escalas: true,
    documentos: true,
    anexosIndex: true,
  };
}

// ---------------------------------------------------------------------------
// Confirmation keyword for personal notes
// ---------------------------------------------------------------------------

const CONFIRMATION_KEYWORD = 'INCLUIR';

/**
 * Client-side email validation schema — mirrors the server-side
 * `exportFiltersSchema.deliveryEmail` (z.string().email().optional()) so
 * the user sees a field-level error BEFORE the Server Action is called.
 */
const deliveryEmailSchema = z.string().email({ message: 'Email invalido.' });

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExportModalProps {
  patientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server Action: request prontuario export. */
  requestExport: (input: {
    patientId: string;
    filters: {
      dateRange: { from: string | null; to: string | null };
      sections: Record<SectionKey, boolean>;
      includePersonalNotes: boolean;
      deliveryEmail?: string;
    };
  }) => Promise<{ ok: true; id: string } | { ok: false; code: string }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Export modal for prontuario PDF generation.
 *
 * Lets the psychologist choose: date range, sections to include, whether to
 * include personal notes (with double confirmation), and an optional email
 * for large export delivery. Submits to `requestProntuarioExport` Server
 * Action.
 *
 * Personal notes require the user to type "INCLUIR" in an AlertDialog to
 * enable — they are excluded by default and must not be shared with patients.
 */
export function ExportModal({ patientId, open, onOpenChange, requestExport }: ExportModalProps) {
  // -- Form state -----------------------------------------------------------
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(defaultSections);
  const [includePersonalNotes, setIncludePersonalNotes] = useState(false);
  const [deliveryEmail, setDeliveryEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  // -- AlertDialog state for personal notes confirmation --------------------
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState('');

  // -- Date picker popover state -------------------------------------------
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  // -- Submission state -----------------------------------------------------
  const [isPending, startTransition] = useTransition();

  // -- Reset form when modal closes -----------------------------------------
  const resetForm = useCallback(() => {
    setDateRange(undefined);
    setSections(defaultSections());
    setIncludePersonalNotes(false);
    setDeliveryEmail('');
    setEmailError(null);
    setConfirmationInput('');
    setNotesDialogOpen(false);
    setDatePopoverOpen(false);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm],
  );

  // -- Section toggle handler -----------------------------------------------
  const handleSectionChange = useCallback((key: SectionKey, checked: boolean) => {
    setSections((prev) => ({ ...prev, [key]: checked }));
  }, []);

  // -- Personal notes toggle handler ----------------------------------------
  // When the user attempts to turn ON, open the confirmation AlertDialog.
  // When turning OFF, just flip the toggle.
  const handlePersonalNotesToggle = useCallback((checked: boolean) => {
    if (checked) {
      // Open confirmation dialog instead of directly enabling
      setConfirmationInput('');
      setNotesDialogOpen(true);
    } else {
      setIncludePersonalNotes(false);
    }
  }, []);

  // -- Confirm personal notes inclusion -------------------------------------
  const handleNotesConfirm = useCallback(() => {
    if (confirmationInput === CONFIRMATION_KEYWORD) {
      setIncludePersonalNotes(true);
      setNotesDialogOpen(false);
      setConfirmationInput('');
    }
  }, [confirmationInput]);

  // -- Cancel personal notes confirmation -----------------------------------
  const handleNotesCancel = useCallback(() => {
    setNotesDialogOpen(false);
    setConfirmationInput('');
    // Toggle stays OFF
  }, []);

  // -- Submit handler -------------------------------------------------------
  const handleSubmit = useCallback(() => {
    // Client-side email validation before calling the server action
    const trimmedEmail = deliveryEmail.trim();
    if (trimmedEmail) {
      const emailResult = deliveryEmailSchema.safeParse(trimmedEmail);
      if (!emailResult.success) {
        setEmailError(emailResult.error.issues[0]?.message ?? 'Email invalido.');
        return;
      }
    }
    setEmailError(null);

    startTransition(() => {
      void requestExport({
        patientId,
        filters: {
          dateRange: {
            from: dateRange?.from ? dateRange.from.toISOString() : null,
            to: dateRange?.to ? dateRange.to.toISOString() : null,
          },
          sections,
          includePersonalNotes,
          deliveryEmail: trimmedEmail || undefined,
        },
      })
        .then((result) => {
          if (result.ok) {
            toast.success('Exportacao solicitada. Voce sera notificado quando estiver pronta.');
            handleOpenChange(false);
          } else if (result.code === 'VALIDATION_ERROR') {
            toast.error('Verifique os campos e tente novamente.');
          } else {
            toast.error('Erro ao solicitar exportacao. Tente novamente.');
          }
        })
        .catch(() => {
          toast.error('Erro ao solicitar exportacao. Tente novamente.');
        });
    });
  }, [
    patientId,
    dateRange,
    sections,
    includePersonalNotes,
    deliveryEmail,
    requestExport,
    handleOpenChange,
    startTransition,
  ]);

  // -- Date range display text ----------------------------------------------
  const dateRangeLabel =
    dateRange?.from && dateRange?.to
      ? `${format(dateRange.from, 'dd/MM/yyyy', { locale: ptBR })} - ${format(dateRange.to, 'dd/MM/yyyy', { locale: ptBR })}`
      : dateRange?.from
        ? `A partir de ${format(dateRange.from, 'dd/MM/yyyy', { locale: ptBR })}`
        : 'Todo o periodo';

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-[540px]" data-testid="export-modal">
          <DialogHeader>
            <DialogTitle>Exportar prontuario</DialogTitle>
            <DialogDescription className="sr-only">
              Configuracoes para exportacao do prontuario em PDF.
            </DialogDescription>
          </DialogHeader>

          {/* Info Alert */}
          <Alert variant="info" data-testid="export-info-alert">
            <Info className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              Esta exportacao sera registrada no log de auditoria. Notas pessoais sao excluidas por
              padrao.
            </AlertDescription>
          </Alert>

          {/* Date Range Picker */}
          <div className="space-y-2">
            <Label>Periodo</Label>
            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                  data-testid="export-date-range-trigger"
                >
                  <CalendarIcon className="h-4 w-4" aria-hidden="true" />
                  {dateRangeLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => {
                    setDateRange(range);
                    // Close popover when both dates are selected
                    if (range?.from && range?.to) {
                      setDatePopoverOpen(false);
                    }
                  }}
                  locale={ptBR}
                  numberOfMonths={2}
                  data-testid="export-date-calendar"
                />
                {dateRange && (
                  <div className="border-border border-t p-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setDateRange(undefined);
                        setDatePopoverOpen(false);
                      }}
                      data-testid="export-date-clear"
                    >
                      Limpar periodo (todo o periodo)
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {/* Sections Checkboxes */}
          <div className="space-y-3">
            <Label>Secoes incluidas</Label>
            <div className="space-y-2" data-testid="export-sections">
              {SECTION_ITEMS.map((item) => (
                <div key={item.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`section-${item.key}`}
                    checked={sections[item.key]}
                    onCheckedChange={(checked) => handleSectionChange(item.key, checked === true)}
                    data-testid={`export-section-${item.key}`}
                  />
                  <Label
                    htmlFor={`section-${item.key}`}
                    className="text-sm leading-snug font-normal"
                  >
                    {item.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Personal Notes Toggle */}
          <div className="space-y-2" data-testid="export-personal-notes-section">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="personal-notes-toggle">Incluir notas pessoais</Label>
                <p className="text-text-secondary text-xs">
                  Notas pessoais sao de uso exclusivo do(a) psicologo(a).
                </p>
              </div>
              <Switch
                id="personal-notes-toggle"
                checked={includePersonalNotes}
                onCheckedChange={handlePersonalNotesToggle}
                data-testid="export-personal-notes-toggle"
              />
            </div>
          </div>

          <Separator />

          {/* Optional Email Input */}
          <div className="space-y-2">
            <Label htmlFor="delivery-email">Email alternativo (opcional)</Label>
            <Input
              id="delivery-email"
              type="email"
              placeholder="Para receber exportacoes grandes (>10MB)"
              value={deliveryEmail}
              onChange={(e) => {
                setDeliveryEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'delivery-email-error' : undefined}
              data-testid="export-delivery-email"
            />
            {emailError && (
              <p
                id="delivery-email-error"
                className="text-destructive text-sm"
                data-testid="export-delivery-email-error"
              >
                {emailError}
              </p>
            )}
          </div>

          {/* Footer */}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
              data-testid="export-cancel"
            >
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid="export-submit">
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Gerando...
                </>
              ) : (
                'Gerar exportacao'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Personal Notes Confirmation AlertDialog */}
      <AlertDialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <AlertDialogContent data-testid="personal-notes-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar inclusao de notas pessoais</AlertDialogTitle>
            <AlertDialogDescription>
              Notas pessoais sao de uso exclusivo do(a) psicologo(a) e nao devem ser entregues ao
              paciente. Digite INCLUIR para confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="notes-confirmation-input">Confirmacao</Label>
            <Input
              id="notes-confirmation-input"
              placeholder='Digite "INCLUIR" para confirmar'
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              autoComplete="off"
              data-testid="personal-notes-confirm-input"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleNotesCancel}
              data-testid="personal-notes-confirm-cancel"
            >
              Cancelar
            </AlertDialogCancel>
            <Button
              onClick={handleNotesConfirm}
              disabled={confirmationInput !== CONFIRMATION_KEYWORD}
              data-testid="personal-notes-confirm-submit"
            >
              Confirmar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
