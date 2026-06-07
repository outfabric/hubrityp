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
              O prontuário e os dados do paciente serão preservados conforme exigido pela legislação
              vigente:
            </span>
            <span className="text-text-tertiary block text-[13px]">
              CFP — Resolução 001/2009: guarda mínima de 5 anos após último atendimento. Lei
              13.787/2018: prontuários em meio digital devem ser mantidos por no mínimo 20 anos.
            </span>
            <span className="block">
              O paciente não aparecerá mais na listagem ativa, mas você poderá desarquivá-lo a
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
