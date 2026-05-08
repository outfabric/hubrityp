'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Loader2, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import type { PatientGuardian } from '@/shared/db/schema/patients/tables';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';

import { isValidBrazilianPhone, maskPhone } from '../lib/patient-validators';

// ---------------------------------------------------------------------------
// Form-specific schema (avoids input/output type mismatch from .default())
// ---------------------------------------------------------------------------

const guardianFormSchema = z.object({
  fullName: z
    .string({ message: 'Informe o nome completo do responsável.' })
    .trim()
    .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
    .max(200, { message: 'O nome deve ter no máximo 200 caracteres.' }),
  relationship: z
    .string({ message: 'Informe o parentesco.' })
    .trim()
    .min(2, { message: 'O parentesco deve ter pelo menos 2 caracteres.' })
    .max(100, { message: 'O parentesco deve ter no máximo 100 caracteres.' }),
  phone: z
    .string({ message: 'Informe o telefone do responsável.' })
    .refine((v) => isValidBrazilianPhone(v), {
      message: 'Telefone inválido. Use o formato +55 DD NNNNN-NNNN.',
    }),
  email: z.string().email({ message: 'E-mail inválido.' }).max(255).optional().or(z.literal('')),
});

type GuardianFormValues = z.infer<typeof guardianFormSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientGuardiansSectionProps {
  patientId: string;
  patientType: string;
  /** Guardians fetched on the server and passed as initial data. */
  initialGuardians: PatientGuardian[];
  /** Server Action to list guardians (used to refresh after mutations). */
  listGuardiansAction: (
    patientId: string,
  ) => Promise<{ ok: true; guardians: PatientGuardian[] } | { ok: false; error: string }>;
  /** Server Action to add a guardian. */
  addGuardianAction: (
    patientId: string,
    input: unknown,
  ) => Promise<
    | { ok: true; guardianId: string }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]>; message?: string }
  >;
  /** Server Action to update a guardian. */
  updateGuardianAction: (
    guardianId: string,
    input: unknown,
  ) => Promise<
    | { ok: true }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]>; message?: string }
  >;
  /** Server Action to remove a guardian. */
  removeGuardianAction: (
    guardianId: string,
  ) => Promise<{ ok: true; warning?: string } | { ok: false; error: string; message?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts only digits from a phone string for building wa.me links. */
function extractPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Guardian form (shared for add/edit)
// ---------------------------------------------------------------------------

interface GuardianFormProps {
  defaultValues?: Partial<GuardianFormValues>;
  onSubmit: (data: GuardianFormValues) => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
}

function GuardianForm({
  defaultValues,
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}: GuardianFormProps) {
  const form = useForm<GuardianFormValues>({
    resolver: zodResolver(guardianFormSchema),
    defaultValues: {
      fullName: defaultValues?.fullName ?? '',
      relationship: defaultValues?.relationship ?? '',
      phone: defaultValues?.phone ?? '',
      email: defaultValues?.email ?? '',
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
        className="space-y-4"
        data-testid="guardian-form"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome completo</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Nome do responsável"
                    data-testid="guardian-form-full-name"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="relationship"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Parentesco</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ex: Mãe, Pai, Avó"
                    data-testid="guardian-form-relationship"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone</FormLabel>
                <FormControl>
                  <Input
                    placeholder="+55 11 99999-9999"
                    data-testid="guardian-form-phone"
                    value={field.value}
                    onChange={(e) => {
                      const masked = maskPhone(e.target.value);
                      field.onChange(masked);
                    }}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input
                    placeholder="email@exemplo.com"
                    type="email"
                    data-testid="guardian-form-email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
            data-testid="guardian-form-cancel"
          >
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={isPending} data-testid="guardian-form-submit">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type FormMode = { type: 'closed' } | { type: 'add' } | { type: 'edit'; guardian: PatientGuardian };

export function PatientGuardiansSection({
  patientId,
  patientType,
  initialGuardians,
  listGuardiansAction,
  addGuardianAction,
  updateGuardianAction,
  removeGuardianAction,
}: PatientGuardiansSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [guardians, setGuardians] = useState<PatientGuardian[]>(initialGuardians);
  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<PatientGuardian | null>(null);

  const isMinor = patientType === 'child' || patientType === 'adolescent';

  /** Re-fetches guardians from server after a mutation. */
  const refreshGuardians = async () => {
    const result = await listGuardiansAction(patientId);
    if (result.ok) {
      setGuardians(result.guardians);
    }
  };

  // Only render for minor patients
  if (!isMinor) {
    return null;
  }

  const handleAdd = (data: GuardianFormValues) => {
    startTransition(async () => {
      const result = await addGuardianAction(patientId, data);
      if (result.ok) {
        toast.success('Responsável adicionado');
        setFormMode({ type: 'closed' });
        await refreshGuardians();
        router.refresh();
      } else {
        toast.error(result.message ?? 'Erro ao adicionar responsável.');
      }
    });
  };

  const handleUpdate = (guardian: PatientGuardian, data: GuardianFormValues) => {
    startTransition(async () => {
      const result = await updateGuardianAction(guardian.id, data);
      if (result.ok) {
        toast.success('Responsável atualizado');
        setFormMode({ type: 'closed' });
        await refreshGuardians();
        router.refresh();
      } else {
        toast.error(result.message ?? 'Erro ao atualizar responsável.');
      }
    });
  };

  const handleRemove = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await removeGuardianAction(deleteTarget.id);
      if (result.ok) {
        toast.success('Responsável removido');
        if (result.warning) {
          toast.warning(result.warning);
        }
        setDeleteTarget(null);
        await refreshGuardians();
        router.refresh();
      } else {
        toast.error(result.message ?? 'Erro ao remover responsável.');
      }
    });
  };

  return (
    <>
      <Card className="shadow-none" data-testid="patient-guardians-section">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-medium">Responsáveis</CardTitle>
          {formMode.type === 'closed' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFormMode({ type: 'add' })}
              disabled={guardians.length >= 2}
              data-testid="guardian-add-button"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Adicionar responsável
            </Button>
          )}
        </CardHeader>

        <CardContent>
          {/* Warning: minor without guardians */}
          {guardians.length === 0 && formMode.type !== 'add' && (
            <Alert variant="warning" data-testid="guardian-warning-no-guardians">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Este paciente menor está sem responsável cadastrado.
              </AlertDescription>
            </Alert>
          )}

          {/* Guardian list */}
          {guardians.length > 0 && (
            <div className="divide-border-subtle divide-y" data-testid="guardian-list">
              {guardians.map((guardian) => (
                <div
                  key={guardian.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  data-testid={`guardian-row-${guardian.id}`}
                >
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                    <span
                      className="text-text-primary text-[15px]"
                      data-testid={`guardian-name-${guardian.id}`}
                    >
                      {guardian.fullName}
                    </span>
                    <span
                      className="text-text-secondary text-xs font-medium"
                      data-testid={`guardian-relationship-${guardian.id}`}
                    >
                      {guardian.relationship}
                    </span>
                    {guardian.isPrimary && (
                      <Badge
                        variant="default"
                        data-testid={`guardian-primary-badge-${guardian.id}`}
                      >
                        Principal
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {guardian.phone && (
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        data-testid={`guardian-whatsapp-${guardian.id}`}
                      >
                        <a
                          href={`https://wa.me/${extractPhoneDigits(guardian.phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Abrir WhatsApp de ${guardian.fullName}`}
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFormMode({ type: 'edit', guardian })}
                      disabled={isPending}
                      aria-label={`Editar ${guardian.fullName}`}
                      data-testid={`guardian-edit-${guardian.id}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(guardian)}
                      disabled={isPending}
                      aria-label={`Remover ${guardian.fullName}`}
                      data-testid={`guardian-delete-${guardian.id}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          {formMode.type === 'add' && (
            <div className="mt-4" data-testid="guardian-add-form">
              <GuardianForm
                onSubmit={handleAdd}
                onCancel={() => setFormMode({ type: 'closed' })}
                isPending={isPending}
                submitLabel="Adicionar"
              />
            </div>
          )}

          {/* Edit form */}
          {formMode.type === 'edit' && (
            <div className="mt-4" data-testid="guardian-edit-form">
              <GuardianForm
                defaultValues={{
                  fullName: formMode.guardian.fullName,
                  relationship: formMode.guardian.relationship,
                  phone: formMode.guardian.phone ?? '',
                  email: formMode.guardian.email ?? '',
                }}
                onSubmit={(data) => handleUpdate(formMode.guardian, data)}
                onCancel={() => setFormMode({ type: 'closed' })}
                isPending={isPending}
                submitLabel="Salvar"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover responsável</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover <strong>{deleteTarget?.fullName}</strong> como
              responsável?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isPending}
              className="bg-danger-500 text-text-inverse hover:bg-danger-700"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
