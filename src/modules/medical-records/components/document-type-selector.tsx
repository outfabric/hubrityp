'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { CreateDocumentResult } from '@/modules/medical-records';
import {
  DOCUMENT_TYPE_LIST,
  type DocumentTypeConfig,
} from '@/modules/medical-records/lib/document-type-config';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import { Card } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentTypeSelectorProps {
  /** Patient UUID. */
  patientId: string;
  /** Server action to create a new document. */
  createDocument: (input: {
    patientId: string;
    document_type: DocumentType;
  }) => Promise<CreateDocumentResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 2-column grid (1-col mobile) of interactive cards for selecting the document
 * type. On click: creates a draft document via server action and navigates to
 * the editor. Shows loading state on the clicked card.
 */
export function DocumentTypeSelector({ patientId, createDocument }: DocumentTypeSelectorProps) {
  const router = useRouter();
  const [loadingType, setLoadingType] = useState<DocumentType | null>(null);

  const handleSelect = useCallback(
    async (config: DocumentTypeConfig) => {
      if (loadingType) return;
      setLoadingType(config.type);

      try {
        const result = await createDocument({
          patientId,
          document_type: config.type,
        });

        if (result.ok) {
          router.push(`/pacientes/${patientId}/prontuario/documentos/${result.id}`);
        } else {
          toast.error('Erro ao criar documento. Tente novamente.');
          setLoadingType(null);
        }
      } catch {
        toast.error('Erro ao criar documento. Tente novamente.');
        setLoadingType(null);
      }
    },
    [patientId, createDocument, router, loadingType],
  );

  return (
    <div data-testid="document-type-selector">
      <h2 className="text-text-primary mb-6 text-xl font-semibold">
        Selecione o tipo de documento
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {DOCUMENT_TYPE_LIST.map((config) => {
          const Icon = config.icon;
          const isLoading = loadingType === config.type;
          const isDisabled = loadingType !== null;

          return (
            <button
              key={config.type}
              type="button"
              onClick={() => void handleSelect(config)}
              disabled={isDisabled}
              className="text-left disabled:opacity-50"
              data-testid={`document-type-${config.type}`}
            >
              <Card className="hover:border-brand-500 h-full cursor-pointer p-6 transition-colors">
                <div className="flex items-start gap-3">
                  {isLoading ? (
                    <Loader2 className="text-brand-500 h-6 w-6 animate-spin" aria-hidden="true" />
                  ) : (
                    <Icon className="text-brand-700 h-6 w-6 shrink-0" aria-hidden="true" />
                  )}
                  <div>
                    <p className="text-text-primary text-sm font-medium">{config.label}</p>
                    <p className="text-text-secondary mt-0.5 text-xs">{config.description}</p>
                  </div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
