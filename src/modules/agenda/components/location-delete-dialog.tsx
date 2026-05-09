'use client';

import { Loader2 } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';

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

interface LocationDeleteDialogProps {
  /** The name of the location to delete (shown in the title). */
  locationName: string;
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog wants to close (cancel or after delete). */
  onOpenChange: (open: boolean) => void;
  /** Server Action to delete the location. */
  onConfirm: () => Promise<{ ok: boolean; error?: string; message?: string }>;
  /** Called after a successful deletion (e.g. to refresh the page). */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Confirmation dialog for deleting a location.
 *
 * Design System Salvia:
 *   - AlertDialog max-width 480px
 *   - Title "Excluir [nome]?"
 *   - Description "Esta acao nao pode ser desfeita."
 *   - Button danger "Excluir", Button secondary "Cancelar"
 */
export function LocationDeleteDialog({
  locationName,
  open,
  onOpenChange,
  onConfirm,
  onSuccess,
}: LocationDeleteDialogProps) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await onConfirm();
      if (result.ok) {
        toast.success('Local excluido com sucesso.');
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(result.message ?? 'Erro ao excluir local.');
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="location-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {locationName}?</AlertDialogTitle>
          <AlertDialogDescription>Esta acao nao pode ser desfeita.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} data-testid="location-delete-cancel">
            Cancelar
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
            data-testid="location-delete-confirm"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Excluindo...
              </>
            ) : (
              'Excluir'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
