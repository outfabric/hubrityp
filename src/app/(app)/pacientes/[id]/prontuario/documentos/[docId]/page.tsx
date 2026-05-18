import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  createDocument,
  finalizeDocument,
  getDocumentDetail,
  getDocumentPdfUrl,
  searchCid10,
  updateDocument,
} from '@/app/(app)/pacientes/[id]/prontuario/actions';
import { DocumentEditor } from '@/modules/medical-records/components/document-editor';
import { DocumentViewer } from '@/modules/medical-records/components/document-viewer';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentDetailPageProps {
  params: Promise<{ id: string; docId: string }>;
}

// ---------------------------------------------------------------------------
// Page (Server Component)
// ---------------------------------------------------------------------------

/**
 * Document detail page — renders editor (draft) or viewer (finalized).
 *
 * Auth: gated by middleware (classifyPath treats /pacientes* as 'app'),
 * ownership confirmed by getDocumentDetail which filters by auth.uid()
 * (defense-in-depth: middleware + server action userId filter + RLS).
 */
export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id: patientId, docId } = await params;

  // Fetch document detail — the server action internally authenticates via
  // supabase.auth.getUser() and filters by userId (defense-in-depth: RLS +
  // explicit userId filter). Returns NOT_FOUND if unauthorized or missing.
  const result = await getDocumentDetail({ documentId: docId });

  if (!result.ok) {
    notFound();
  }

  const document = result.document;

  // Verify the document belongs to this patient URL to prevent URL tampering
  if (document.patientId !== patientId) {
    notFound();
  }

  const documentContent = (document.content ?? {}) as Record<string, unknown>;
  const documentType = document.documentType as DocumentType;

  return (
    <div className="mx-auto max-w-[720px]">
      {/* Back navigation */}
      <div className="mb-4">
        <Link href={`/pacientes/${patientId}/prontuario`}>
          <Button variant="ghost" size="sm" data-testid="document-detail-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar ao prontuario
          </Button>
        </Link>
      </div>

      {document.status === 'draft' ? (
        <DocumentEditor
          documentId={document.id}
          patientId={patientId}
          documentType={documentType}
          initialTitle={document.title}
          initialContent={documentContent}
          updateDocument={updateDocument}
          finalizeDocument={finalizeDocument}
          getDocumentPdfUrl={getDocumentPdfUrl}
          searchCid10={searchCid10}
        />
      ) : (
        <DocumentViewer
          documentId={document.id}
          patientId={patientId}
          documentType={documentType}
          title={document.title}
          content={documentContent}
          hasPdf={!!document.pdfStoragePath}
          getDocumentPdfUrl={getDocumentPdfUrl}
          createDocument={createDocument}
        />
      )}
    </div>
  );
}
