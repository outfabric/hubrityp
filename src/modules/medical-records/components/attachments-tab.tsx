'use client';

import { Paperclip, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type {
  AttachmentCategory,
  DeleteAttachmentResult,
  GetAttachmentSignedUrlResult,
  ListAttachmentsResult,
  UploadAttachmentResult,
} from '@/modules/medical-records';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { AttachmentCard, type AttachmentCardData } from './attachment-card';
import { AttachmentUploadSheet } from './attachment-upload-sheet';

// ---------------------------------------------------------------------------
// Category filter options
// ---------------------------------------------------------------------------

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'exam', label: 'Exame externo' },
  { value: 'image', label: 'Imagem' },
  { value: 'drawing', label: 'Desenho' },
  { value: 'audio', label: 'Audio' },
  { value: 'other', label: 'Outro' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AttachmentsTabProps {
  /** Patient UUID. */
  patientId: string;
  /** Whether the patient has an active consent term (gates audio uploads). */
  hasActiveConsent: boolean;
  /** Server action: list attachments for a patient. */
  listAttachments: (input: {
    patientId: string;
    category?: AttachmentCategory;
  }) => Promise<ListAttachmentsResult>;
  /** Server action: upload an attachment. */
  uploadAttachment: (
    patientId: string,
    formData: FormData,
  ) => Promise<UploadAttachmentResult>;
  /** Server action: get a signed URL for an attachment. */
  getAttachmentSignedUrl: (input: {
    attachmentId: string;
  }) => Promise<GetAttachmentSignedUrlResult>;
  /** Server action: soft-delete an attachment. */
  deleteAttachment: (input: {
    attachmentId: string;
  }) => Promise<DeleteAttachmentResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Container component for the "Anexos" prontuario tab.
 *
 * Responsibilities:
 * - Header row (h3 "Anexos" + primary "Anexar arquivo" button)
 * - Optional category filter Select
 * - AttachmentCard list with inline preview (PDF iframe, img for images)
 * - Empty state per Salvia pattern
 * - Destructive AlertDialog for delete confirmation with retention notice
 * - AttachmentUploadSheet for adding new files
 *
 * Follows the same data-fetch-in-useEffect pattern as HypothesesTab/ScalesTab.
 */
export function AttachmentsTab({
  patientId,
  hasActiveConsent,
  listAttachments,
  uploadAttachment,
  getAttachmentSignedUrl,
  deleteAttachment,
}: AttachmentsTabProps) {
  const [attachments, setAttachments] = useState<AttachmentCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Inline preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMimeType, setPreviewMimeType] = useState<string | null>(null);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);

  // Load attachments on mount and when filter changes
  const loadAttachments = useCallback(async () => {
    setLoading(true);
    const input: { patientId: string; category?: AttachmentCategory } = { patientId };
    if (filter !== 'all') {
      input.category = filter as AttachmentCategory;
    }
    const result = await listAttachments(input);
    if (result.ok) {
      setAttachments(mapToCardData(result.attachments));
    }
    setLoading(false);
  }, [patientId, filter, listAttachments]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const input: { patientId: string; category?: AttachmentCategory } = { patientId };
      if (filter !== 'all') {
        input.category = filter as AttachmentCategory;
      }
      const result = await listAttachments(input);
      if (!cancelled && result.ok) {
        setAttachments(mapToCardData(result.attachments));
      }
      if (!cancelled) {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, filter, listAttachments]);

  // Handlers
  const handleUploadOpen = useCallback(() => {
    setSheetOpen(true);
  }, []);

  const handleUploaded = useCallback(() => {
    void loadAttachments();
  }, [loadAttachments]);

  const handlePreview = useCallback(
    async (attachmentId: string) => {
      const attachment = attachments.find((a) => a.id === attachmentId);
      if (!attachment) return;

      const result = await getAttachmentSignedUrl({ attachmentId });
      if (result.ok) {
        // Toggle preview off if clicking the same attachment
        if (previewAttachmentId === attachmentId) {
          setPreviewUrl(null);
          setPreviewMimeType(null);
          setPreviewAttachmentId(null);
        } else {
          setPreviewUrl(result.signedUrl);
          setPreviewMimeType(attachment.mimeType);
          setPreviewAttachmentId(attachmentId);
        }
      } else {
        toast.error('Nao foi possivel gerar a visualizacao. Tente novamente.');
      }
    },
    [attachments, getAttachmentSignedUrl, previewAttachmentId],
  );

  const handleDeleteRequest = useCallback((attachmentId: string) => {
    setDeleteTarget(attachmentId);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    const result = await deleteAttachment({ attachmentId: deleteTarget });
    setDeleting(false);

    if (result.ok) {
      toast.success('Arquivo removido do prontuario.');
      // Close preview if the deleted attachment was being previewed
      if (previewAttachmentId === deleteTarget) {
        setPreviewUrl(null);
        setPreviewMimeType(null);
        setPreviewAttachmentId(null);
      }
      setDeleteTarget(null);
      void loadAttachments();
    } else {
      toast.error('Erro ao excluir arquivo. Tente novamente.');
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteAttachment, previewAttachmentId, loadAttachments]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  return (
    <div className="space-y-6" data-testid="attachments-tab">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-text-primary text-lg font-semibold">Anexos</h3>
        <Button onClick={handleUploadOpen} data-testid="attachments-upload-button">
          <Paperclip className="mr-2 h-4 w-4" aria-hidden="true" />
          Anexar arquivo
        </Button>
      </div>

      {/* Category filter */}
      <div className="max-w-[200px]">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger data-testid="attachments-category-filter">
            <SelectValue placeholder="Filtrar por categoria" />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                data-testid={`attachments-filter-${opt.value}`}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16" data-testid="attachments-loading">
          <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : attachments.length === 0 ? (
        <AttachmentsEmptyState onUpload={handleUploadOpen} />
      ) : (
        <div className="space-y-4" data-testid="attachments-list">
          {attachments.map((attachment) => (
            <div key={attachment.id}>
              <AttachmentCard
                attachment={attachment}
                onPreview={() => void handlePreview(attachment.id)}
                onDelete={handleDeleteRequest}
              />
              {/* Inline preview */}
              {previewAttachmentId === attachment.id && previewUrl && (
                <div
                  className="border-border mt-2 overflow-hidden rounded-lg border"
                  data-testid={`attachment-preview-${attachment.id}`}
                >
                  {previewMimeType === 'application/pdf' ? (
                    <iframe
                      src={previewUrl}
                      title={`Visualizacao de ${attachment.displayName}`}
                      className="h-[500px] w-full"
                    />
                  ) : previewMimeType?.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Signed URL from Supabase Storage; next/image cannot optimize external signed URLs with short expiry
                    <img
                      src={previewUrl}
                      alt={attachment.displayName}
                      className="max-h-[500px] w-full object-contain"
                    />
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload sheet */}
      <AttachmentUploadSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        patientId={patientId}
        hasActiveConsent={hasActiveConsent}
        uploadAttachment={uploadAttachment}
        onUploaded={handleUploaded}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && handleDeleteCancel()}>
        <AlertDialogContent data-testid="attachment-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir arquivo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza? O arquivo sera removido do prontuario (mantemos uma copia auditavel por 5
              anos).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleDeleteCancel}
              disabled={deleting}
              data-testid="attachment-delete-cancel"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteConfirm()}
              disabled={deleting}
              className="bg-danger-500 text-text-inverse hover:bg-danger-700"
              data-testid="attachment-delete-confirm"
            >
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

interface AttachmentsEmptyStateProps {
  onUpload: () => void;
}

/**
 * Salvia empty state for the attachments tab.
 *
 * Three parts per design rules:
 * - What is missing (icon + heading)
 * - Why it matters (description)
 * - What to do (CTA)
 */
function AttachmentsEmptyState({ onUpload }: AttachmentsEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="attachments-empty-state"
    >
      <Upload className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
      <h4 className="text-text-primary mb-1 text-lg font-semibold">Nenhum anexo</h4>
      <p className="text-text-secondary mb-4 max-w-sm text-sm">
        Adicione documentos, imagens ou audios para manter o prontuario do paciente completo.
      </p>
      <Button onClick={onUpload} data-testid="attachments-empty-cta">
        Anexar arquivo
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapToCardData(
  summaries: {
    id: string;
    displayName: string;
    fileSize: number;
    mimeType: string;
    category: string;
    uploadedAt: Date;
  }[],
): AttachmentCardData[] {
  return summaries.map((s) => ({
    id: s.id,
    displayName: s.displayName,
    fileSize: s.fileSize,
    mimeType: s.mimeType,
    category: s.category,
    uploadedAt: new Date(s.uploadedAt),
  }));
}
