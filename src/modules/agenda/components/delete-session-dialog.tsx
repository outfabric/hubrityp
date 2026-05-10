'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIRMATION_WORD = 'EXCLUIR';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeleteSessionDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** Server Action to soft-delete the session. */
  onConfirm: () => Promise<{ ok: boolean; error?: string; message?: string }>;
  /** Called after a successful deletion (e.g., to refresh sessions). */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Confirmation dialog for soft-deleting a session.
 *
 * Design System Salvia:
 *   - AlertDialog max-width 480px
 *   - Title h3 "Excluir sessao definitivamente"
 *   - Body text warning in danger-700
 *   - Input requiring user to type "EXCLUIR" to enable confirm button
 *   - "Excluir definitivamente" Button danger (disabled until input matches)
 *   - "Cancelar" Button secondary
 *   - On success: toast "Sessao excluida" (Sonner)
 */
export function DeleteSessionDialog({
  open,
  onOpenChange,
  onConfirm,
  onSuccess,
}: DeleteSessionDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState('');

  const isConfirmEnabled = confirmText === CONFIRMATION_WORD;

  function handleConfirm() {
    startTransition(async () => {
      const result = await onConfirm();

      if (result.ok) {
        toast.success('Sessao excluida');
        setConfirmText('');
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(result.message ?? 'Erro ao excluir sessao.');
      }
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setConfirmText('');
    }
    onOpenChange(nextOpen);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="delete-session-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir sessao definitivamente</AlertDialogTitle>
          <AlertDialogDescription className="text-danger-700">
            Esta acao nao pode ser desfeita. A sessao sera removida permanentemente e nao podera ser
            recuperada.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="delete-confirm-input">
            Digite <span className="font-semibold">{CONFIRMATION_WORD}</span> para confirmar
          </Label>
          <Input
            id="delete-confirm-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRMATION_WORD}
            autoComplete="off"
            data-testid="delete-confirm-input"
          />
        </div>

        <AlertDialogFooter>
          <Button
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
            data-testid="delete-dialog-cancel"
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isConfirmEnabled || isPending}
            data-testid="delete-dialog-confirm"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Excluindo...
              </>
            ) : (
              'Excluir definitivamente'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
