'use client';

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ArchiveConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ArchiveConfirmModal — AlertDialog that explains the legal basis for archival
 * (CFP Resolution + Lei 13.787/2018) and asks for confirmation.
 *
 * Design System Salvia:
 *   - max-width 480px, padding space-8, radius 2xl
 *   - "Arquivar" as Button primary, "Cancelar" as Button secondary
 *   - Escape/click-outside closes the modal
 */
export function ArchiveConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}: ArchiveConfirmModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="archive-confirm-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar paciente</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 space-y-2">
            <span className="block">
              O prontuario e os dados do paciente serao preservados conforme exigido pela legislacao
              vigente:
            </span>
            <span className="text-text-tertiary block text-[13px]">
              CFP — Resolucao 001/2009: guarda minima de 5 anos apos ultimo atendimento. Lei
              13.787/2018: prontuarios em meio digital devem ser mantidos por no minimo 20 anos.
            </span>
            <span className="block">
              O paciente nao aparecera mais na listagem ativa, mas voce podera desarquiva-lo a
              qualquer momento.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={isPending} data-testid="archive-confirm-cancel">
            Cancelar
          </AlertDialogCancel>
          <Button onClick={onConfirm} disabled={isPending} data-testid="archive-confirm-submit">
            {isPending ? 'Arquivando...' : 'Arquivar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
