'use client';

import { FilePlus2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type {
  GetDocumentPdfUrlResult,
  ListDocumentsByPatientResult,
} from '@/modules/medical-records';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { DocumentCard, type DocumentCardData } from './document-card';
import { DocumentsEmptyState } from './documents-empty-state';

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

const TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'declaracao', label: 'Declaracao' },
  { value: 'atestado', label: 'Atestado' },
  { value: 'relatorio', label: 'Relatorio' },
  { value: 'laudo', label: 'Laudo' },
  { value: 'parecer', label: 'Parecer' },
];

type StatusFilter = 'all' | 'draft' | 'finalized';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentsTabProps {
  /** Patient UUID. */
  patientId: string;
  /** Server action: list documents for a patient. */
  listDocumentsByPatient: (input: {
    patientId: string;
    type?: DocumentType;
    status?: 'draft' | 'finalized';
  }) => Promise<ListDocumentsByPatientResult>;
  /** Server action: get signed URL for PDF download. */
  getDocumentPdfUrl: (input: { documentId: string }) => Promise<GetDocumentPdfUrlResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Container component for the "Documentos clinicos" tab.
 *
 * Renders:
 * - Header with h3 title + "Novo documento" CTA (links to type selector page)
 * - Filter row: type select + status badge group
 * - DocumentCard list or empty state
 */
export function DocumentsTab({
  patientId,
  listDocumentsByPatient,
  getDocumentPdfUrl,
}: DocumentsTabProps) {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Load documents when filters or patientId change.
  // Uses the cancelled-flag pattern (like HypothesesTab) to satisfy the
  // React Compiler's set-state-in-effect rule — all setState calls happen
  // inside an async callback, not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const input: {
        patientId: string;
        type?: DocumentType;
        status?: 'draft' | 'finalized';
      } = { patientId };

      if (typeFilter !== 'all') {
        input.type = typeFilter as DocumentType;
      }
      if (statusFilter !== 'all') {
        input.status = statusFilter;
      }

      const result = await listDocumentsByPatient(input);

      if (!cancelled && result.ok) {
        setDocuments(
          result.documents.map((d) => ({
            ...d,
            pdfStoragePath: d.pdfStoragePath,
            createdAt: new Date(d.createdAt),
            updatedAt: new Date(d.updatedAt),
            finalizedAt: d.finalizedAt ? new Date(d.finalizedAt) : null,
          })),
        );
      }
      if (!cancelled) {
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [patientId, typeFilter, statusFilter, listDocumentsByPatient]);

  const novoDocumentoPath = `/pacientes/${patientId}/prontuario/documentos/novo`;

  return (
    <div className="space-y-6" data-testid="documents-tab">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-text-primary text-lg font-semibold">Documentos clinicos</h3>
        <Button asChild data-testid="documents-new-button">
          <Link href={novoDocumentoPath}>
            <FilePlus2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Novo documento
          </Link>
        </Button>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[200px]" data-testid="documents-type-filter">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status badge group */}
        <div className="flex gap-1.5" role="group" aria-label="Filtrar por status">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            data-testid="documents-status-all"
          >
            <Badge variant={statusFilter === 'all' ? 'default' : 'neutral'}>Todos</Badge>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('draft')}
            data-testid="documents-status-draft"
          >
            <Badge variant={statusFilter === 'draft' ? 'default' : 'neutral'}>Rascunho</Badge>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('finalized')}
            data-testid="documents-status-finalized"
          >
            <Badge variant={statusFilter === 'finalized' ? 'default' : 'neutral'}>Finalizado</Badge>
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16" data-testid="documents-loading">
          <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : documents.length === 0 ? (
        <DocumentsEmptyState
          onAdd={() => {
            router.push(novoDocumentoPath);
          }}
        />
      ) : (
        <div className="space-y-4" data-testid="documents-list">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} document={doc} getDocumentPdfUrl={getDocumentPdfUrl} />
          ))}
        </div>
      )}
    </div>
  );
}
