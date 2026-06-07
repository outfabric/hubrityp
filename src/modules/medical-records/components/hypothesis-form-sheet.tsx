'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import type { Cid10Result } from '@/modules/medical-records';
import type { HypothesisStatus } from '@/modules/medical-records/lib/schemas/hypothesis';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet';
import { Textarea } from '@/shared/ui/textarea';

import { Cid10Combobox } from './cid10-combobox';
import type { HypothesisCardData } from './hypothesis-card';

// ---------------------------------------------------------------------------
// Form schema (client-side validation)
// ---------------------------------------------------------------------------

const hypothesisFormSchema = z
  .object({
    mode: z.enum(['cid10', 'descriptive']),
    cid10Code: z.string().optional(),
    cid10Description: z.string().optional(),
    description: z.string().max(500, 'Descrição deve ter no máximo 500 caracteres.').optional(),
    status: z.enum(['investigating', 'confirmed', 'discarded']),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'cid10' && !data.cid10Code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Preencha o campo obrigatório do modo selecionado.',
        path: ['cid10Code'],
      });
    } else if (data.mode === 'descriptive' && !data.description?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Preencha o campo obrigatório do modo selecionado.',
        path: ['description'],
      });
    }
  });

type HypothesisFormValues = z.infer<typeof hypothesisFormSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HypothesisFormSheetProps {
  /** Whether the sheet is open. */
  open: boolean;
  /** Callback to close the sheet. */
  onOpenChange: (open: boolean) => void;
  /** Hypothesis to edit (null = create mode). */
  editingHypothesis: HypothesisCardData | null;
  /** Server action to create a hypothesis. */
  onCreate: (input: {
    patientId: string;
    description?: string;
    cid10Code?: string;
    cid10Description?: string;
    notes?: string;
  }) => Promise<{ ok: true; id: string } | { ok: false; code: string }>;
  /** Server action to update a hypothesis. */
  onUpdate: (input: {
    hypothesisId: string;
    description?: string;
    cid10Code?: string;
    cid10Description?: string;
    status?: HypothesisStatus;
    notes?: string;
  }) => Promise<{ ok: true } | { ok: false; code: string }>;
  /** Server action to search CID-10 codes. */
  onSearchCid10: (query: string) => Promise<Cid10Result[]>;
  /** Patient ID for creating new hypotheses. */
  patientId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sheet (right-side, max-w 480px) for adding or editing a hypothesis.
 *
 * Features:
 * - React Hook Form + Zod resolver
 * - RadioGroup toggle: "Por CID-10" / "Descritiva"
 * - Conditional fields based on mode
 * - Status Select with three options
 * - Notes Textarea (optional)
 * - Validation inline on blur
 * - Sonner toast on success
 * - Focus trap (Sheet primitive handles this via Radix Dialog)
 */
export function HypothesisFormSheet({
  open,
  onOpenChange,
  editingHypothesis,
  onCreate,
  onUpdate,
  onSearchCid10,
  patientId,
}: HypothesisFormSheetProps) {
  const isEditing = editingHypothesis !== null;

  const form = useForm<HypothesisFormValues>({
    resolver: zodResolver(hypothesisFormSchema),
    defaultValues: getDefaultValues(editingHypothesis),
    mode: 'onBlur',
  });

  // Reset form when the sheet opens with different data
  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues(editingHypothesis));
    }
  }, [open, editingHypothesis, form]);

  const handleSubmit = useCallback(
    async (values: HypothesisFormValues) => {
      if (isEditing) {
        const result = await onUpdate({
          hypothesisId: editingHypothesis.id,
          description: values.mode === 'descriptive' ? values.description : undefined,
          cid10Code: values.mode === 'cid10' ? values.cid10Code : undefined,
          cid10Description: values.mode === 'cid10' ? values.cid10Description : undefined,
          status: values.status,
          notes: values.notes || undefined,
        });

        if (result.ok) {
          toast.success('Hipótese atualizada com sucesso.');
          onOpenChange(false);
        } else {
          toast.error('Erro ao atualizar hipótese. Tente novamente.');
        }
      } else {
        const result = await onCreate({
          patientId,
          description: values.mode === 'descriptive' ? values.description : undefined,
          cid10Code: values.mode === 'cid10' ? values.cid10Code : undefined,
          cid10Description: values.mode === 'cid10' ? values.cid10Description : undefined,
          notes: values.notes || undefined,
        });

        if (result.ok) {
          toast.success('Hipótese criada com sucesso.');
          onOpenChange(false);
        } else {
          toast.error('Erro ao criar hipótese. Tente novamente.');
        }
      }
    },
    [isEditing, editingHypothesis, onCreate, onUpdate, onOpenChange, patientId],
  );

  const mode = form.watch('mode');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" data-testid="hypothesis-form-sheet">
        <SheetHeader>
          <SheetTitle>{isEditing ? 'Editar hipótese' : 'Adicionar hipótese'}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? 'Altere os campos desejados e salve.'
              : 'Preencha os dados da nova hipótese diagnóstica.'}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(handleSubmit)(e)}
            className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-4"
          >
            {/* Mode toggle */}
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de hipótese</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="flex flex-row gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="cid10" id="mode-cid10" />
                        <Label htmlFor="mode-cid10" className="cursor-pointer text-sm">
                          Por CID-10
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="descriptive" id="mode-descriptive" />
                        <Label htmlFor="mode-descriptive" className="cursor-pointer text-sm">
                          Descritiva
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* CID-10 mode fields */}
            {mode === 'cid10' && (
              <FormField
                control={form.control}
                name="cid10Code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código CID-10</FormLabel>
                    <FormControl>
                      <Cid10Combobox
                        value={
                          field.value
                            ? {
                                code: field.value,
                                description: form.getValues('cid10Description') || '',
                              }
                            : null
                        }
                        onChange={(selected) => {
                          if (selected) {
                            form.setValue('cid10Code', selected.code);
                            form.setValue('cid10Description', selected.description);
                          } else {
                            form.setValue('cid10Code', undefined);
                            form.setValue('cid10Description', undefined);
                          }
                          void form.trigger('cid10Code');
                        }}
                        onSearch={onSearchCid10}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Descriptive mode fields */}
            {mode === 'descriptive' && (
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição da hipótese</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Descreva a hipótese diagnóstica..."
                        maxLength={500}
                        data-testid="hypothesis-description-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Status select */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="hypothesis-status-select">
                        <SelectValue placeholder="Selecione o status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="investigating">Em investigação</SelectItem>
                      <SelectItem value="confirmed">Confirmada</SelectItem>
                      <SelectItem value="discarded">Descartada</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes textarea */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Adicione observações ou justificativas..."
                      data-testid="hypothesis-notes-input"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Footer */}
            <SheetFooter className="mt-auto pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                data-testid="hypothesis-form-cancel"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                data-testid="hypothesis-form-submit"
              >
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar hipótese
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultValues(hypothesis: HypothesisCardData | null): HypothesisFormValues {
  if (!hypothesis) {
    return {
      mode: 'cid10',
      cid10Code: undefined,
      cid10Description: undefined,
      description: undefined,
      status: 'investigating',
      notes: undefined,
    };
  }

  const hasCid10 = Boolean(hypothesis.cid10Code);
  return {
    mode: hasCid10 ? 'cid10' : 'descriptive',
    cid10Code: hypothesis.cid10Code || undefined,
    cid10Description: hypothesis.cid10Description || undefined,
    description: hypothesis.description || undefined,
    status: hypothesis.status,
    notes: hypothesis.notes || undefined,
  };
}
