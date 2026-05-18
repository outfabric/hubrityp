'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max polling attempts (2s interval x 30 = 60s timeout). */
const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FinalizeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  patientId: string;
  /** Whether the document references CID-10 codes (triggers consent gate). */
  referencesCid10: boolean;
  /** Server action: finalize the document. */
  finalizeDocument: (input: {
    documentId: string;
    cid10ConsentConfirmed?: boolean;
  }) => Promise<{ ok: true; data: { id: string } } | { ok: false; code: string }>;
  /** Server action: get PDF URL (for polling). */
  getDocumentPdfUrl: (input: {
    documentId: string;
  }) => Promise<
    { ok: true; data: { signedUrl: string; expiresIn: number } } | { ok: false; code: string }
  >;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Destructive confirmation modal for document finalization.
 *
 * Features:
 * - Warning about immutability after finalization
 * - CID-10 consent checkbox when applicable (RN-05.06)
 * - Confirm button disabled until consent checked (when required)
 * - After confirm: calls finalizeDocument, polls for PDF readiness, shows
 *   toast with download link
 */
export function FinalizeModal({
  open,
  onOpenChange,
  documentId,
  patientId,
  referencesCid10,
  finalizeDocument,
  getDocumentPdfUrl,
}: FinalizeModalProps) {
  const router = useRouter();
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a stable ref to getDocumentPdfUrl so the polling loop does not
  // need to be a useCallback that captures it (avoids the "accessed before
  // declared" lint error when a callback references itself recursively).
  const getPdfUrlRef = useRef(getDocumentPdfUrl);
  useEffect(() => {
    getPdfUrlRef.current = getDocumentPdfUrl;
  }, [getDocumentPdfUrl]);

  const canConfirm = !referencesCid10 || consentChecked;

  /**
   * Starts polling for PDF readiness. Uses a ref-based loop instead of a
   * recursive useCallback to avoid the "accessed before declared" lint error.
   */
  const startPdfPolling = useCallback(() => {
    let attempt = 0;

    function poll() {
      if (attempt >= MAX_POLL_ATTEMPTS) {
        toast.info('PDF sendo gerado. Atualize a pagina em alguns instantes para baixar.');
        return;
      }

      pollTimerRef.current = setTimeout(() => {
        void getPdfUrlRef
          .current({ documentId })
          .then((result) => {
            if (result.ok) {
              toast.success('PDF pronto!', {
                action: {
                  label: 'Baixar',
                  onClick: () =>
                    window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer'),
                },
                duration: 10_000,
              });
            } else if (result.code === 'PDF_NOT_READY') {
              attempt += 1;
              poll();
            } else {
              toast.info('PDF sendo gerado. Atualize a pagina em alguns instantes para baixar.');
            }
          })
          .catch(() => {
            toast.info('PDF sendo gerado. Atualize a pagina em alguns instantes para baixar.');
          });
      }, POLL_INTERVAL_MS);
    }

    poll();
  }, [documentId]);

  const handleConfirm = useCallback(() => {
    setLoading(true);

    void finalizeDocument({
      documentId,
      cid10ConsentConfirmed: referencesCid10 ? consentChecked : undefined,
    })
      .then((result) => {
        if (result.ok) {
          toast.info('Gerando PDF...');
          onOpenChange(false);

          // Start polling for PDF readiness
          startPdfPolling();

          // Navigate to the viewer (finalized view)
          router.push(`/pacientes/${patientId}/prontuario/documentos/${documentId}`);
          router.refresh();
        } else {
          if (result.code === 'CID10_CONSENT_REQUIRED') {
            toast.error('Confirme o consentimento do paciente para inclusao do CID-10.');
          } else if (result.code === 'ALREADY_FINALIZED') {
            toast.info('Documento ja finalizado.');
            onOpenChange(false);
            router.refresh();
          } else {
            toast.error('Erro ao finalizar documento. Tente novamente.');
          }
        }
      })
      .catch(() => {
        toast.error('Erro ao finalizar documento. Tente novamente.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [
    documentId,
    patientId,
    referencesCid10,
    consentChecked,
    finalizeDocument,
    onOpenChange,
    startPdfPolling,
    router,
  ]);

  // Clean up polling on unmount/close
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
      setConsentChecked(false);
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="finalize-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>Finalizar documento</AlertDialogTitle>
          <AlertDialogDescription>
            Apos finalizacao, este documento nao podera ser editado. Uma nova versao exige criar um
            novo documento.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* CID-10 consent gate */}
        {referencesCid10 && (
          <div className="border-warning-200 bg-warning-50 flex items-start gap-3 rounded-lg border p-4">
            <AlertTriangle
              className="text-warning-700 mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <div className="flex items-start gap-2">
              <Checkbox
                id="cid10-consent"
                checked={consentChecked}
                onCheckedChange={(checked) => setConsentChecked(checked === true)}
                data-testid="finalize-cid10-consent"
              />
              <Label htmlFor="cid10-consent" className="text-sm leading-snug">
                Confirmo que o paciente consentiu com a inclusao do(s) codigo(s) CID-10 (RN-05.06).
              </Label>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} data-testid="finalize-cancel">
            Cancelar
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            data-testid="finalize-confirm"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                Finalizando...
              </>
            ) : (
              'Finalizar'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
