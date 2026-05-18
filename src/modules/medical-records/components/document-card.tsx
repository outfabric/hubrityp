'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Download, Eye, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { GetDocumentPdfUrlResult } from '@/modules/medical-records';
import { DOCUMENT_TYPE_CONFIGS } from '@/modules/medical-records/lib/document-type-config';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentCardData {
  id: string;
  patientId: string;
  documentType: string;
  title: string;
  status: string;
  referencesCid10: boolean;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentCardProps {
  document: DocumentCardData;
  /** Server action to get a signed PDF download URL. */
  getDocumentPdfUrl: (input: { documentId: string }) => Promise<GetDocumentPdfUrlResult>;
}

// ---------------------------------------------------------------------------
// Status badge mapping
// ---------------------------------------------------------------------------

const STATUS_BADGE_MAP: Record<string, { variant: 'neutral' | 'success'; label: string }> = {
  draft: { variant: 'neutral', label: 'Rascunho' },
  finalized: { variant: 'success', label: 'Finalizado' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Card for a clinical document (Salvia card pattern: radius xl, shadow xs, p-6).
 *
 * Shows type icon, title, creation date, status badge, and contextual action
 * buttons depending on document status:
 * - Draft: "Editar" link to editor
 * - Finalized: "Visualizar" link + "Baixar PDF" button
 */
export function DocumentCard({ document: doc, getDocumentPdfUrl }: DocumentCardProps) {
  const [downloading, setDownloading] = useState(false);

  const typeConfig = DOCUMENT_TYPE_CONFIGS[doc.documentType as DocumentType];
  const Icon = typeConfig?.icon;
  const typeLabel = typeConfig?.label ?? doc.documentType;
  const badge = STATUS_BADGE_MAP[doc.status] ?? { variant: 'neutral' as const, label: 'Rascunho' };

  const createdFormatted = format(new Date(doc.createdAt), "dd 'de' MMM 'de' yyyy", {
    locale: ptBR,
  });

  const prontuarioBase = `/pacientes/${doc.patientId}/prontuario/documentos`;

  const handleDownloadPdf = useCallback(() => {
    setDownloading(true);
    void getDocumentPdfUrl({ documentId: doc.id })
      .then((result) => {
        if (result.ok) {
          window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer');
        } else if (result.code === 'PDF_NOT_READY') {
          toast.info('PDF ainda sendo gerado. Tente novamente em alguns instantes.');
        } else {
          toast.error('Erro ao obter PDF. Tente novamente.');
        }
      })
      .catch(() => {
        toast.error('Erro ao obter PDF. Tente novamente.');
      })
      .finally(() => {
        setDownloading(false);
      });
  }, [doc.id, getDocumentPdfUrl]);

  return (
    <Card className="p-6" data-testid={`document-card-${doc.id}`}>
      <div className="flex items-start justify-between gap-3">
        {/* Left: icon + title + meta */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            {Icon && <Icon className="text-text-tertiary h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="text-text-primary text-sm font-medium">{doc.title || typeLabel}</span>
          </div>
          <p className="text-text-tertiary text-xs">
            {typeLabel} &middot; Criado em {createdFormatted}
          </p>
        </div>

        {/* Right: badge + actions */}
        <div className="flex items-center gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>

          {doc.status === 'draft' && (
            <Button variant="ghost" size="sm" asChild data-testid={`document-edit-${doc.id}`}>
              <Link href={`${prontuarioBase}/${doc.id}`}>
                <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Editar
              </Link>
            </Button>
          )}

          {doc.status === 'finalized' && (
            <>
              <Button variant="ghost" size="sm" asChild data-testid={`document-view-${doc.id}`}>
                <Link href={`${prontuarioBase}/${doc.id}`}>
                  <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Visualizar
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={downloading}
                data-testid={`document-download-${doc.id}`}
              >
                <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {downloading ? 'Baixando...' : 'Baixar PDF'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
