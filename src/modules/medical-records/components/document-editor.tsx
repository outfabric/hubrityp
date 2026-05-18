'use client';

import { Loader2, Shield } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { Cid10Result, UpdateDocumentResult } from '@/modules/medical-records';
import {
  DOCUMENT_SECTIONS,
  DOCUMENT_TYPE_CONFIGS,
  type SectionConfig,
} from '@/modules/medical-records/lib/document-type-config';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import { TiptapEditor } from '@/modules/patients/components/tiptap-editor';
import { useAutoSave } from '@/modules/patients/lib/use-auto-save';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

import { AutoSaveIndicator } from './auto-save-indicator';
import { Cid10Combobox } from './cid10-combobox';
import { FinalizeModal } from './finalize-modal';

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

interface DocumentEditorProps {
  /** Document ID. */
  documentId: string;
  /** Patient ID. */
  patientId: string;
  /** Document type. */
  documentType: DocumentType;
  /** Initial title. */
  initialTitle: string;
  /** Initial content. */
  initialContent: DocumentContent;
  /** Server action: update the document. */
  updateDocument: (input: {
    documentId: string;
    title?: string;
    content?: Record<string, unknown>;
  }) => Promise<UpdateDocumentResult>;
  /** Server action: finalize the document. */
  finalizeDocument: (input: {
    documentId: string;
    cid10ConsentConfirmed?: boolean;
  }) => Promise<{ ok: true; data: { id: string } } | { ok: false; code: string }>;
  /** Server action: get PDF URL (for post-finalize polling). */
  getDocumentPdfUrl: (input: {
    documentId: string;
  }) => Promise<
    { ok: true; data: { signedUrl: string; expiresIn: number } } | { ok: false; code: string }
  >;
  /** Server action: search CID-10 codes. */
  searchCid10: (query: string) => Promise<Cid10Result[]>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Structured document editor with per-section Tiptap editors, CID-10 combobox,
 * auto-save (10s debounce), and finalize modal.
 */
export function DocumentEditor({
  documentId,
  patientId,
  documentType,
  initialTitle,
  initialContent,
  updateDocument,
  finalizeDocument,
  getDocumentPdfUrl,
  searchCid10,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState<DocumentContent>(() => ({ ...initialContent }));
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const typeConfig = DOCUMENT_TYPE_CONFIGS[documentType];
  const sections = DOCUMENT_SECTIONS[documentType];

  // Derive a placeholder title from the type label when the user has not set one
  const titlePlaceholder = typeConfig?.label ?? 'Titulo do documento';

  // Build the saveable payload: combine title + content for auto-save
  const savePayload = useMemo(() => ({ title, content }), [title, content]);

  const handleAutoSave = useCallback(
    async (payload: { title: string; content: DocumentContent }) => {
      await updateDocument({
        documentId,
        title: payload.title,
        content: payload.content,
      });
    },
    [documentId, updateDocument],
  );

  const { status: autoSaveStatus, lastSavedAt } = useAutoSave(savePayload, handleAutoSave, {
    interval: 10_000,
  });

  const handleManualSave = useCallback(() => {
    setSaving(true);
    void updateDocument({
      documentId,
      title,
      content,
    }).finally(() => {
      setSaving(false);
    });
  }, [documentId, title, content, updateDocument]);

  const updateSection = useCallback((key: string, value: unknown) => {
    setContent((prev) => ({ ...prev, [key]: value }));
  }, []);

  // CID-10 list management
  const cid10Codes = (content.cid10Codes as Cid10Entry[] | undefined) ?? [];

  const handleAddCid10 = useCallback((entry: { code: string; description: string } | null) => {
    if (!entry) return;
    setContent((prev) => {
      const existing = (prev.cid10Codes as Cid10Entry[] | undefined) ?? [];
      // Prevent duplicates
      if (existing.some((e) => e.code === entry.code)) return prev;
      return { ...prev, cid10Codes: [...existing, entry] };
    });
  }, []);

  const handleRemoveCid10 = useCallback((code: string) => {
    setContent((prev) => {
      const existing = (prev.cid10Codes as Cid10Entry[] | undefined) ?? [];
      return { ...prev, cid10Codes: existing.filter((e) => e.code !== code) };
    });
  }, []);

  // Check if required fields are filled (for the finalize button)
  const canFinalize = useMemo(() => {
    for (const section of sections) {
      if (!section.required) continue;
      if (section.key === 'cid10Codes') continue;

      if (section.key === 'localData') {
        const ld = content.localData as { local?: string; data?: string } | undefined;
        if (!ld?.local?.trim() || !ld?.data?.trim()) return false;
      } else {
        const val = content[section.key];
        if (typeof val !== 'string' || val.trim().length === 0) return false;
      }
    }
    return true;
  }, [content, sections]);

  const referencesCid10 = cid10Codes.length > 0;

  return (
    <div className="flex max-w-[720px] flex-col gap-6" data-testid="document-editor">
      {/* Header: title + status badge + auto-save indicator */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="neutral">Rascunho</Badge>
          <AutoSaveIndicator status={autoSaveStatus} lastSavedAt={lastSavedAt} />
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          className="text-lg font-semibold"
          aria-label="Titulo do documento"
          data-testid="document-title-input"
        />
      </div>

      {/* Sections */}
      {sections.map((section) => (
        <DocumentSection
          key={section.key}
          section={section}
          content={content}
          cid10Codes={cid10Codes}
          onSectionChange={updateSection}
          onAddCid10={handleAddCid10}
          onRemoveCid10={handleRemoveCid10}
          searchCid10={searchCid10}
        />
      ))}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button
          onClick={() => setFinalizeOpen(true)}
          disabled={!canFinalize}
          data-testid="document-finalize-button"
        >
          Finalizar e gerar PDF
        </Button>
        <Button
          variant="link"
          onClick={handleManualSave}
          disabled={saving}
          data-testid="document-save-draft-button"
        >
          {saving ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Salvando...
            </>
          ) : (
            'Salvar rascunho'
          )}
        </Button>
        <Button variant="secondary" disabled data-testid="document-sign-button">
          <Shield className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Assinar com e-CPF
          <Badge variant="neutral" className="ml-2">
            Em breve
          </Badge>
        </Button>
      </div>

      {/* Finalize modal */}
      <FinalizeModal
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        documentId={documentId}
        patientId={patientId}
        referencesCid10={referencesCid10}
        finalizeDocument={finalizeDocument}
        getDocumentPdfUrl={getDocumentPdfUrl}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentSection (renders each section type)
// ---------------------------------------------------------------------------

interface DocumentSectionProps {
  section: SectionConfig;
  content: DocumentContent;
  cid10Codes: Cid10Entry[];
  onSectionChange: (key: string, value: unknown) => void;
  onAddCid10: (entry: { code: string; description: string } | null) => void;
  onRemoveCid10: (code: string) => void;
  searchCid10: (query: string) => Promise<Cid10Result[]>;
}

function DocumentSection({
  section,
  content,
  cid10Codes,
  onSectionChange,
  onAddCid10,
  onRemoveCid10,
  searchCid10,
}: DocumentSectionProps) {
  const sectionId = `section-${section.key}`;

  // CID-10 section — uses Cid10Combobox + list of selected codes
  if (section.key === 'cid10Codes') {
    return (
      <div className="flex flex-col gap-1.5" data-testid="document-section-cid10">
        <Label id={sectionId}>{section.label}</Label>
        {/* Selected codes */}
        {cid10Codes.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {cid10Codes.map((entry) => (
              <div
                key={entry.code}
                className="border-border bg-surface-sunken flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-brand-700 font-mono text-sm font-medium">{entry.code}</span>
                  <span className="text-text-secondary ml-2 truncate text-sm">
                    {entry.description}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveCid10(entry.code)}
                  className="text-text-tertiary hover:text-danger-700 text-xs"
                  aria-label={`Remover ${entry.code}`}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Add new CID-10 */}
        <Cid10Combobox value={null} onChange={onAddCid10} onSearch={searchCid10} />
      </div>
    );
  }

  // Local e Data section — two inputs
  if (section.key === 'localData') {
    const localData = (content.localData as { local?: string; data?: string } | undefined) ?? {};
    return (
      <div className="flex flex-col gap-3" data-testid="document-section-localData">
        <Label id={sectionId}>
          {section.label}
          {section.required && <span className="text-danger-500 ml-1">*</span>}
        </Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${sectionId}-local`} className="text-xs">
              Local
            </Label>
            <Input
              id={`${sectionId}-local`}
              value={localData.local ?? ''}
              onChange={(e) =>
                onSectionChange('localData', { ...localData, local: e.target.value })
              }
              placeholder="Cidade, UF"
              aria-labelledby={sectionId}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${sectionId}-data`} className="text-xs">
              Data
            </Label>
            <Input
              id={`${sectionId}-data`}
              value={localData.data ?? ''}
              onChange={(e) => onSectionChange('localData', { ...localData, data: e.target.value })}
              placeholder="dd/mm/aaaa"
              aria-labelledby={sectionId}
            />
          </div>
        </div>
      </div>
    );
  }

  // Period / Validity — simple text input
  if (section.key === 'period' || section.key === 'validity') {
    return (
      <div className="flex flex-col gap-1.5" data-testid={`document-section-${section.key}`}>
        <Label htmlFor={sectionId}>
          {section.label}
          {section.required && <span className="text-danger-500 ml-1">*</span>}
        </Label>
        <Input
          id={sectionId}
          value={(content[section.key] as string) ?? ''}
          onChange={(e) => onSectionChange(section.key, e.target.value)}
          placeholder={section.placeholder}
        />
      </div>
    );
  }

  // Default: rich text section using Tiptap
  return (
    <div className="flex flex-col gap-1.5" data-testid={`document-section-${section.key}`}>
      <Label id={sectionId}>
        {section.label}
        {section.required && <span className="text-danger-500 ml-1">*</span>}
      </Label>
      <div
        className={cn(
          'rounded-md border',
          'bg-surface-sunken',
          'focus-within:border-brand-500 focus-within:shadow-focus',
        )}
      >
        <TiptapEditor
          content={(content[section.key] as string) ?? ''}
          onChange={(html) => onSectionChange(section.key, html)}
          placeholder={section.placeholder}
          aria-label={section.label}
        />
      </div>
    </div>
  );
}
