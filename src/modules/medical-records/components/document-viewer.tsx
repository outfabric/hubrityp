'use client';

import DOMPurify from 'isomorphic-dompurify';
import { Copy, Download, Lock, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { CreateDocumentResult, GetDocumentPdfUrlResult } from '@/modules/medical-records';
import {
  DOCUMENT_SECTIONS,
  DOCUMENT_TYPE_CONFIGS,
} from '@/modules/medical-records/lib/document-type-config';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocumentContent = Record<string, unknown>;

interface Cid10Entry {
  code: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentViewerProps {
  /** Document ID. */
  documentId: string;
  /** Patient ID. */
  patientId: string;
  /** Document type. */
  documentType: DocumentType;
  /** Document title. */
  title: string;
  /** Document content (JSONB). */
  content: DocumentContent;
  /** Whether PDF is available for download. */
  hasPdf: boolean;
  /** Server action: get PDF download URL. */
  getDocumentPdfUrl: (input: { documentId: string }) => Promise<GetDocumentPdfUrlResult>;
  /** Server action: create a new document (for "create similar"). */
  createDocument: (input: {
    patientId: string;
    document_type: DocumentType;
    title?: string;
    content?: Record<string, unknown>;
  }) => Promise<CreateDocumentResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Read-only viewer for finalized clinical documents.
 *
 * Renders all sections as non-interactive content, header with title, status
 * badge, lock icon, and action buttons for PDF download and "create similar".
 */
export function DocumentViewer({
  documentId,
  patientId,
  documentType,
  title,
  content,
  hasPdf,
  getDocumentPdfUrl,
  createDocument,
}: DocumentViewerProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [cloning, setCloning] = useState(false);

  const typeConfig = DOCUMENT_TYPE_CONFIGS[documentType];
  const sections = DOCUMENT_SECTIONS[documentType];
  const cid10Codes = (content.cid10Codes as Cid10Entry[] | undefined) ?? [];

  const handleDownloadPdf = useCallback(() => {
    setDownloading(true);
    void getDocumentPdfUrl({ documentId })
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
  }, [documentId, getDocumentPdfUrl]);

  const handleCreateSimilar = useCallback(() => {
    setCloning(true);
    void createDocument({
      patientId,
      document_type: documentType,
      title: `${title} (copia)`,
      content,
    })
      .then((result) => {
        if (result.ok) {
          router.push(`/pacientes/${patientId}/prontuario/documentos/${result.id}`);
        } else {
          toast.error('Erro ao criar documento. Tente novamente.');
        }
      })
      .catch(() => {
        toast.error('Erro ao criar documento. Tente novamente.');
      })
      .finally(() => {
        setCloning(false);
      });
  }, [patientId, documentType, title, content, createDocument, router]);

  return (
    <div className="flex max-w-[720px] flex-col gap-6" data-testid="document-viewer">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="success">Finalizado</Badge>
          <Lock className="text-text-tertiary h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <h2 className="text-text-primary text-xl font-semibold" data-testid="document-viewer-title">
          {title || typeConfig?.label || 'Documento'}
        </h2>
        <p className="text-text-secondary text-sm">
          Este documento foi finalizado e nao pode ser editado.
        </p>
      </div>

      {/* Sections rendered read-only */}
      {sections.map((section) => {
        if (section.key === 'cid10Codes') {
          if (cid10Codes.length === 0) return null;
          return (
            <div key={section.key} className="flex flex-col gap-1.5">
              <p className="text-text-secondary text-sm font-medium">{section.label}</p>
              <div className="flex flex-col gap-1">
                {cid10Codes.map((entry) => (
                  <div key={entry.code} className="text-sm">
                    <span className="text-brand-700 font-mono font-medium">{entry.code}</span>
                    <span className="text-text-primary ml-2">{entry.description}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (section.key === 'localData') {
          const localData = content.localData as { local?: string; data?: string } | undefined;
          if (!localData?.local && !localData?.data) return null;
          return (
            <div key={section.key} className="flex flex-col gap-1.5">
              <p className="text-text-secondary text-sm font-medium">{section.label}</p>
              <p className="text-text-primary text-sm">
                {[localData.local, localData.data].filter(Boolean).join(', ')}
              </p>
            </div>
          );
        }

        const value = content[section.key];
        if (typeof value !== 'string' || !value.trim()) return null;

        return (
          <div
            key={section.key}
            className="flex flex-col gap-1.5"
            data-testid={`document-viewer-section-${section.key}`}
          >
            <p className="text-text-secondary text-sm font-medium">{section.label}</p>
            <div
              className="prose prose-sm text-text-primary max-w-none"
              // Content was authored in our Tiptap editor but passes through
              // z.record(z.string(), z.unknown()) and lives in JSONB — the
              // "sanitized by Tiptap" invariant does not hold for all write
              // paths. DOMPurify provides defense-in-depth sanitization.
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }}
            />
          </div>
        );
      })}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button
          onClick={handleDownloadPdf}
          disabled={!hasPdf || downloading}
          data-testid="document-viewer-download"
        >
          <Download className="mr-1 h-4 w-4" aria-hidden="true" />
          {downloading ? 'Baixando...' : 'Baixar PDF'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleCreateSimilar}
          disabled={cloning}
          data-testid="document-viewer-clone"
        >
          <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
          {cloning ? 'Criando...' : 'Criar novo documento similar'}
        </Button>
        <Button variant="secondary" disabled data-testid="document-viewer-sign">
          <Shield className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Assinar com e-CPF
          <Badge variant="neutral" className="ml-2">
            Em breve
          </Badge>
        </Button>
      </div>
    </div>
  );
}
