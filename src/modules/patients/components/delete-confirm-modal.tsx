'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';

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
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIRMATION_TEXT = 'EXCLUIR DEFINITIVAMENTE';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeleteConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DeleteConfirmModal — destructive confirmation dialog.
 *
 * The user must type "EXCLUIR DEFINITIVAMENTE" in a text field to enable the
 * delete button. This follows the Design System Salvia pattern for irreversible
 * actions.
 *
 * Design System Salvia:
 *   - max-width 480px, padding space-8, radius 2xl, shadow lg
 *   - Button danger with Trash2 icon, disabled until input matches
 *   - "Esta acao e irreversivel" warning message
 */
export function DeleteConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}: DeleteConfirmModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const isConfirmed = confirmText === CONFIRMATION_TEXT;

  // Reset input when modal closes
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setConfirmText('');
    }
    onOpenChange(nextOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="delete-confirm-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir paciente</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 space-y-3">
            <span className="text-danger-700 block font-medium">Esta ação é irreversível.</span>
            <span className="block">
              Todos os dados deste paciente serão permanentemente removidos. Esta ação não pode ser
              desfeita.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="mt-4 space-y-2">
          <Label htmlFor="delete-confirm-input">
            Digite <span className="text-text-primary font-semibold">{CONFIRMATION_TEXT}</span> para
            confirmar:
          </Label>
          <Input
            id="delete-confirm-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRMATION_TEXT}
            autoComplete="off"
            data-testid="delete-confirm-input"
          />
        </div>

        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={isPending} data-testid="delete-confirm-cancel">
            Cancelar
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!isConfirmed || isPending}
            data-testid="delete-confirm-submit"
          >
            <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
            {isPending ? 'Excluindo...' : 'Excluir definitivamente'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
