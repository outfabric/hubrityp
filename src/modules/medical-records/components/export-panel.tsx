'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/shared/ui/button';

import { ExportModal, type ExportModalProps } from './export-modal';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExportPanelProps {
  patientId: string;
  /** Server Action: request prontuario export (passed from the RSC page). */
  requestExport: ExportModalProps['requestExport'];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Thin client wrapper that renders the "Exportar prontuario" button and
 * controls the ExportModal's open state.
 *
 * This exists because the prontuario page is a Server Component — it cannot
 * hold React state for the dialog open/close. The RSC page renders this
 * component and passes the Server Action down.
 */
export function ExportPanel({ patientId, requestExport }: ExportPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="export-prontuario-button"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Exportar prontuário
      </Button>

      <ExportModal
        patientId={patientId}
        open={open}
        onOpenChange={setOpen}
        requestExport={requestExport}
      />
    </>
  );
}
