'use client';

import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExportConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user confirms the export. Receives whether clinical data should be included. */
  onConfirm: (includeClinicalData: boolean) => void;
  isPending?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ExportConfirmModal — AlertDialog for confirming patient PDF export.
 *
 * Displays a checkbox to optionally include clinical data (anamnesis) and a
 * secrecy warning when that option is selected. The export button shows a
 * loading spinner while the PDF is being generated.
 *
 * Design System Salvia:
 *   - AlertDialog max-width 480px, padding space-8, radius 2xl
 *   - Checkbox "Incluir dados clinicos (anamnese)"
 *   - Alert variant warning (bg warning-50, text warning-700, AlertTriangle icon)
 *   - Button primary "Exportar" with Download icon + loading state
 *   - Button secondary "Cancelar"
 */
export function ExportConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}: ExportConfirmModalProps) {
  const [includeClinicalData, setIncludeClinicalData] = useState(false);

  // Reset checkbox when modal closes
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setIncludeClinicalData(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        className="max-w-[480px] rounded-2xl p-8"
        data-testid="export-confirm-modal"
      >
        <AlertDialogHeader>
          <AlertDialogTitle asChild>
            <h3>Exportar dados do paciente</h3>
          </AlertDialogTitle>
        </AlertDialogHeader>

        <div className="mt-4 space-y-4">
          {/* Checkbox — include clinical data */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="include-clinical-data"
              checked={includeClinicalData}
              onCheckedChange={(checked) => setIncludeClinicalData(checked === true)}
              disabled={isPending}
              data-testid="export-include-clinical-checkbox"
            />
            <Label htmlFor="include-clinical-data" className="cursor-pointer text-sm leading-none">
              Incluir dados clínicos (anamnese)
            </Label>
          </div>

          {/* Secrecy warning — shown when clinical data is selected */}
          {includeClinicalData && (
            <Alert variant="warning" data-testid="export-secrecy-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                Os dados clínicos são sigilosos. Compartilhe apenas quando estritamente necessário.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <AlertDialogFooter className="mt-6">
          <AlertDialogCancel disabled={isPending} data-testid="export-confirm-cancel">
            Cancelar
          </AlertDialogCancel>
          <Button
            onClick={() => onConfirm(includeClinicalData)}
            disabled={isPending}
            data-testid="export-confirm-submit"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {isPending ? 'Exportando...' : 'Exportar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
