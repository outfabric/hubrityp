'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { LucideIcon } from 'lucide-react';
import { Eye, FileText, Image, Mic, Paperclip, Trash2 } from 'lucide-react';

import type { AttachmentCategory } from '@/modules/medical-records';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// File icon sub-component (avoids dynamic component creation during render)
// ---------------------------------------------------------------------------

function FileIcon({ mimeType }: { mimeType: string }) {
  let Icon: LucideIcon = Paperclip;
  if (mimeType === 'application/pdf') Icon = FileText;
  else if (mimeType.startsWith('image/')) Icon = Image;
  else if (mimeType.startsWith('audio/')) Icon = Mic;

  return <Icon className="text-text-tertiary h-5 w-5" aria-hidden="true" />;
}

/** Human-readable category labels (Portuguese). */
const CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  exam: 'Exame externo',
  image: 'Imagem',
  drawing: 'Desenho',
  audio: 'Audio',
  other: 'Outro',
};

/** Formats bytes to a human-readable string (e.g. "1.2 MB"). */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AttachmentCardData {
  id: string;
  displayName: string;
  fileSize: number;
  mimeType: string;
  category: string;
  uploadedAt: Date;
}

interface AttachmentCardProps {
  attachment: AttachmentCardData;
  /** Called when the user clicks the preview (eye) button. */
  onPreview: (id: string) => void;
  /** Called when the user clicks the delete (trash) button. */
  onDelete: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Card for a single file attachment in the prontuario Anexos tab.
 *
 * Follows the Salvia card pattern: radius xl, shadow xs, padding space-6.
 * Shows file icon (type-based), truncated display_name, formatted file size,
 * category Badge, uploaded date, and action buttons (preview, delete).
 */
export function AttachmentCard({ attachment, onPreview, onDelete }: AttachmentCardProps) {
  const { id, displayName, fileSize, mimeType, category, uploadedAt } = attachment;
  const categoryLabel = CATEGORY_LABELS[category as AttachmentCategory] ?? category;

  const uploadedFormatted = format(new Date(uploadedAt), "dd 'de' MMM 'de' yyyy", {
    locale: ptBR,
  });

  return (
    <Card className="p-6" data-testid={`attachment-card-${id}`}>
      <div className="flex items-start gap-4">
        {/* File icon */}
        <div className="bg-surface-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          <FileIcon mimeType={mimeType} />
        </div>

        {/* File info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-text-primary truncate text-sm font-medium" title={displayName}>
                {displayName}
              </p>
              <div className="text-text-tertiary mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span>{formatFileSize(fileSize)}</span>
                <span aria-hidden="true">·</span>
                <span>{uploadedFormatted}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="neutral">{categoryLabel}</Badge>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Visualizar arquivo"
            onClick={() => onPreview(id)}
            data-testid={`attachment-preview-${id}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Excluir arquivo"
            onClick={() => onDelete(id)}
            data-testid={`attachment-delete-${id}`}
          >
            <Trash2 className="text-danger-500 h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
