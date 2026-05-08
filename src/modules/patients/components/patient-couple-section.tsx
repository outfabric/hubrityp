'use client';

import { LinkIcon, Loader2, Unlink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { Patient } from '@/shared/db/schema/patients/tables';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

import type { UnlinkCoupleResult } from '../server/unlink-couple';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientCoupleSectionProps {
  /** The current patient's ID (used by the unlink action). */
  patientId: string;
  /** Pre-fetched partner data. */
  partner: Patient;
  /** Server Action to unlink the couple. */
  unlinkCoupleAction: (patientId: string) => Promise<UnlinkCoupleResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientCoupleSection({
  patientId,
  partner,
  unlinkCoupleAction,
}: PatientCoupleSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleUnlink() {
    startTransition(async () => {
      const result = await unlinkCoupleAction(patientId);

      if (result.ok) {
        toast.success('Casal desvinculado com sucesso.');
        setDialogOpen(false);
        router.refresh();
      } else {
        const message =
          'message' in result ? result.message : 'Erro ao desvincular casal. Tente novamente.';
        toast.error(message);
      }
    });
  }

  return (
    <Card className="shadow-none" data-testid="patient-couple-section">
      <CardHeader>
        <h4 className="text-text-primary text-base font-medium">Parceiro(a)</h4>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <LinkIcon className="text-text-tertiary h-4 w-4" aria-hidden="true" />
            <Button
              variant="link"
              asChild
              className="h-auto p-0"
              data-testid="patient-couple-partner-link"
            >
              <Link href={`/pacientes/${partner.id}`}>{partner.fullName}</Link>
            </Button>
          </div>

          <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-700 hover:text-danger-700"
                data-testid="patient-couple-unlink-trigger"
              >
                <Unlink className="h-4 w-4" aria-hidden="true" />
                Desvincular casal
              </Button>
            </AlertDialogTrigger>

            <AlertDialogContent data-testid="patient-couple-unlink-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>Desvincular casal?</AlertDialogTitle>
                <AlertDialogDescription>
                  Ao desvincular, ambos os pacientes deixam de estar associados como casal e passam
                  a ser tratados como pacientes individuais. Essa ação não exclui nenhum registro
                  clínico.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleUnlink}
                  disabled={isPending}
                  className="bg-danger-500 text-text-inverse hover:bg-danger-700"
                  data-testid="patient-couple-unlink-confirm"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Unlink className="h-4 w-4" aria-hidden="true" />
                  )}
                  Desvincular
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
