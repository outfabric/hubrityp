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
  /**
   * When `true`, the modal confirms an *unarchive* action and renders
   * unarchive-appropriate copy. Defaults to `false` (archive).
   */
  isArchived?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ArchiveConfirmModal — AlertDialog that confirms an archive/unarchive action.
 *
 * In archive mode it explains the legal basis for archival (CFP Resolution +
 * Lei 13.787/2018); in unarchive mode it confirms restoring the patient to the
 * active listing. The copy, title, and confirm button label follow `isArchived`.
 *
 * Design System Salvia:
 *   - max-width 480px, padding space-8, radius 2xl
 *   - primary confirm `Button`, "Cancelar" as secondary
 *   - Escape/click-outside closes the modal
 */
export function ArchiveConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
  isArchived = false,
}: ArchiveConfirmModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="archive-confirm-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isArchived ? 'Desarquivar paciente' : 'Arquivar paciente'}
          </AlertDialogTitle>
          {isArchived ? (
            <AlertDialogDescription className="mt-2">
              O paciente voltará a aparecer na listagem ativa e poderá ser atendido normalmente.
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="mt-2 space-y-2">
              <span className="block">
                O prontuário e os dados do paciente serão preservados conforme exigido pela
                legislação vigente:
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
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={isPending} data-testid="archive-confirm-cancel">
            Cancelar
          </AlertDialogCancel>
          <Button onClick={onConfirm} disabled={isPending} data-testid="archive-confirm-submit">
            {isArchived
              ? isPending
                ? 'Desarquivando...'
                : 'Desarquivar'
              : isPending
                ? 'Arquivando...'
                : 'Arquivar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
