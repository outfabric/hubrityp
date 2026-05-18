'use client';

import { AlertTriangle, Loader2, Paperclip, Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { AttachmentCategory, UploadAttachmentResult } from '@/modules/medical-records';
import { MAX_FILE_SIZE_BYTES } from '@/modules/medical-records/lib/attachment-schemas';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS: { value: AttachmentCategory; label: string }[] = [
  { value: 'exam', label: 'Exame externo' },
  { value: 'image', label: 'Imagem' },
  { value: 'drawing', label: 'Desenho' },
  { value: 'audio', label: 'Audio' },
  { value: 'other', label: 'Outro' },
];

const FILE_TYPE_LEGEND = 'PDF, JPG, PNG, MP3, MP4, DOC, DOCX';

const ERROR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: 'Arquivo excede o limite de 50MB.',
  INVALID_MIME: 'Tipo de arquivo nao permitido para esta categoria.',
  CONSENT_REQUIRED:
    'Gravacoes requerem termo de consentimento assinado (CFP 13/2022).',
  UNAUTHORIZED: 'Voce nao tem permissao para realizar esta acao.',
  NOT_FOUND: 'Paciente nao encontrado.',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AttachmentUploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  /** Whether the patient has an active consent term (for audio uploads). */
  hasActiveConsent: boolean;
  /** Server action: upload an attachment. */
  uploadAttachment: (
    patientId: string,
    formData: FormData,
  ) => Promise<UploadAttachmentResult>;
  /** Called after a successful upload so the parent can refresh the list. */
  onUploaded: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sheet (right side) for uploading an attachment to a patient's prontuario.
 *
 * Includes:
 * - Dropzone (drag-and-drop + click-to-pick)
 * - File type legend + "Max 50MB" helper
 * - Category RadioGroup
 * - Consent warning Alert when category=audio and no active consent
 * - Progress bar during upload
 * - Sonner toast on success/error
 */
export function AttachmentUploadSheet({
  open,
  onOpenChange,
  patientId,
  hasActiveConsent,
  uploadAttachment,
  onUploaded,
}: AttachmentUploadSheetProps) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<AttachmentCategory>('exam');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isAudioBlocked = category === 'audio' && !hasActiveConsent;
  const canSubmit = !!file && !isAudioBlocked && !uploading;

  const resetState = useCallback(() => {
    setFile(null);
    setCategory('exam');
    setProgress(0);
    setUploading(false);
    setDragOver(false);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetState();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetState],
  );

  const handleFileChange = useCallback((selected: File | null) => {
    if (!selected) return;
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      toast.error('Arquivo excede o limite de 50MB.');
      return;
    }
    setFile(selected);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0] ?? null;
      handleFileChange(selected);
    },
    [handleFileChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files?.[0] ?? null;
      handleFileChange(dropped);
    },
    [handleFileChange],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!file || isAudioBlocked) return;

    setUploading(true);
    setProgress(30);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);

    try {
      setProgress(60);
      const result = await uploadAttachment(patientId, formData);
      setProgress(100);

      if (result.ok) {
        toast.success(`Arquivo "${result.displayName}" anexado com sucesso.`);
        resetState();
        onOpenChange(false);
        onUploaded();
      } else {
        const message =
          ERROR_MESSAGES[result.code] ?? 'Erro ao anexar arquivo. Tente novamente.';
        toast.error(message);
      }
    } catch {
      toast.error('Erro ao anexar arquivo. Tente novamente.');
    } finally {
      setUploading(false);
    }
  }, [
    file,
    category,
    isAudioBlocked,
    patientId,
    uploadAttachment,
    resetState,
    onOpenChange,
    onUploaded,
  ]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" data-testid="attachment-upload-sheet">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle>Anexar arquivo</SheetTitle>
          <SheetDescription>
            Adicione documentos, imagens ou audios ao prontuario do paciente.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-4">
          {/* Dropzone */}
          <div>
            <div
              role="button"
              tabIndex={0}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragOver
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-border hover:border-brand-400 hover:bg-surface-muted'
              }`}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              data-testid="attachment-dropzone"
            >
              <Upload className="text-text-tertiary mb-3 h-8 w-8" aria-hidden="true" />
              {file ? (
                <p className="text-text-primary text-sm font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-text-primary text-sm font-medium">
                    Arraste ou clique para selecionar
                  </p>
                  <p className="text-text-tertiary mt-1 text-xs">
                    {FILE_TYPE_LEGEND}
                  </p>
                </>
              )}
              <p className="text-text-tertiary mt-2 text-xs">Max 50MB</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={handleInputChange}
              accept=".pdf,.jpg,.jpeg,.png,.webp,.mp3,.mp4,.m4a,.wav,.doc,.docx"
              data-testid="attachment-file-input"
            />
          </div>

          {/* Category RadioGroup */}
          <div>
            <Label className="text-text-primary mb-2 block text-sm font-medium">
              Categoria
            </Label>
            <RadioGroup
              value={category}
              onValueChange={(v) => setCategory(v as AttachmentCategory)}
              data-testid="attachment-category-radio"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-3">
                  <RadioGroupItem
                    value={opt.value}
                    id={`category-${opt.value}`}
                    data-testid={`attachment-category-${opt.value}`}
                  />
                  <Label htmlFor={`category-${opt.value}`} className="cursor-pointer text-sm">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Consent warning for audio without active consent */}
          {isAudioBlocked && (
            <Alert variant="warning" data-testid="attachment-consent-warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Gravacoes requerem termo de consentimento assinado (CFP 13/2022).{' '}
                <button
                  type="button"
                  className="text-warning-700 font-medium underline underline-offset-2"
                  data-testid="attachment-consent-link"
                >
                  Solicitar consentimento
                </button>
              </AlertDescription>
            </Alert>
          )}

          {/* Progress bar during upload */}
          {uploading && (
            <div data-testid="attachment-upload-progress">
              <div className="bg-surface-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className="bg-brand-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="text-text-tertiary mt-1 text-xs">Enviando...</p>
            </div>
          )}
        </div>

        <SheetFooter className="px-6 pb-6">
          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            data-testid="attachment-submit-button"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Paperclip className="mr-2 h-4 w-4" />
                Anexar
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
