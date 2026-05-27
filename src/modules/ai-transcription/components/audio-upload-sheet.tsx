'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileAudio, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Progress } from '@/shared/ui/progress';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

import type { ConfirmAudioUploadResult, RequestAudioUploadUrlResult } from '../server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Consent status — mirrors the shape returned by `getAiConsentStatus`. */
interface ConsentStatusView {
  state: 'none' | 'pending' | 'active' | 'revoked';
}

interface ConsentStatusResult {
  ok: true;
  consent: ConsentStatusView;
}

type GetAiConsentStatusFn = (patientId: string) => Promise<ConsentStatusResult | { ok: false }>;

type RequestAudioUploadUrlFn = (input: {
  patientId: string;
  sessionId: string | null;
  contentType: string;
  sizeBytes: number;
}) => Promise<RequestAudioUploadUrlResult>;

type ConfirmAudioUploadFn = (input: {
  transcriptionId: string;
  audioDurationSeconds: number | null;
}) => Promise<ConfirmAudioUploadResult>;

export interface AudioUploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  sessionId?: string | null;
  /** Server Action to fetch AI consent status for the patient. */
  getConsentStatusAction: GetAiConsentStatusFn;
  /** Server Action to request a signed upload URL. */
  requestUploadUrlAction: RequestAudioUploadUrlFn;
  /** Server Action to confirm the upload after PUT succeeds. */
  confirmUploadAction: ConfirmAudioUploadFn;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AI_CONSENT_QUERY_KEY = 'ai-consent';

/** UI-side accept hint — the server allowlist is authoritative. */
const ACCEPT_AUDIO = 'audio/*';

/** Maximum file size in bytes (200 MB) — UI hint; server validates too. */
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Error code → pt-BR message map
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Você precisa estar logado para enviar áudios.',
  NOT_FOUND: 'Paciente não encontrado.',
  CONSENT_INACTIVE: 'O paciente ainda não assinou o termo de transcrição por IA.',
  CONTENT_TYPE_NOT_ALLOWED: 'Tipo de arquivo não suportado. Envie MP3, M4A, WAV ou WebM.',
  SIZE_EXCEEDED: 'Tamanho excedido (max. 200MB).',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um minuto e tente novamente.',
  INVALID_MIME: 'O arquivo enviado não é um áudio válido.',
  SIZE_MISMATCH: 'O tamanho do arquivo não corresponde ao declarado.',
  ALREADY_CONFIRMED: 'Este áudio já foi enviado anteriormente.',
};

function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? 'Erro ao enviar o áudio. Tente novamente.';
}

// ---------------------------------------------------------------------------
// File size formatting helper
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// XHR upload helper
// ---------------------------------------------------------------------------

/**
 * Uploads a file to a signed URL using XMLHttpRequest for progress tracking.
 *
 * Wrapped in a Promise that resolves on a 200 response and rejects on
 * error/abort/non-200 status.
 *
 * On error: `confirmAudioUpload` is NOT called. The row remains in
 * `status='pending'` and the discard cron (24h) will clean it up. This is
 * intentional — the signed URL may have been consumed, and the server
 * cannot reliably know whether partial bytes reached Storage.
 */
function uploadFileViaXhr(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };

    xhr.onabort = () => {
      reject(new Error('Upload was aborted'));
    };

    xhr.send(file);
  });
}

// ---------------------------------------------------------------------------
// Upload state machine
// ---------------------------------------------------------------------------

type UploadStage = 'idle' | 'requesting-url' | 'uploading' | 'confirming' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AudioUploadSheet({
  open,
  onOpenChange,
  patientId,
  sessionId = null,
  getConsentStatusAction,
  requestUploadUrlAction,
  confirmUploadAction,
}: AudioUploadSheetProps) {
  // ---- Local state ----------------------------------------------------------

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // ---- Query: AI consent status ---------------------------------------------

  const {
    data: consentData,
    isLoading: consentLoading,
    isError: consentError,
  } = useQuery({
    queryKey: [AI_CONSENT_QUERY_KEY, patientId],
    queryFn: async () => {
      const result = await getConsentStatusAction(patientId);
      if (!result.ok) {
        throw new Error('Failed to load consent status');
      }
      return result.consent;
    },
    enabled: open,
  });

  const isConsentActive = consentData?.state === 'active';

  // ---- Mutation: Full upload flow -------------------------------------------

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Step 1: Request signed upload URL
      setUploadStage('requesting-url');
      setUploadProgress(0);

      const urlResult = await requestUploadUrlAction({
        patientId,
        sessionId,
        contentType: file.type,
        sizeBytes: file.size,
      });

      if (!urlResult.ok) {
        throw new UploadError(urlResult.code);
      }

      // Step 2: PUT to signed URL (XHR for progress)
      setUploadStage('uploading');

      await uploadFileViaXhr(urlResult.uploadUrl, file, file.type, (pct) => {
        setUploadProgress(pct);
      });

      // Step 3: Confirm upload
      setUploadStage('confirming');

      const confirmResult = await confirmUploadAction({
        transcriptionId: urlResult.transcriptionId,
        audioDurationSeconds: null,
      });

      if (!confirmResult.ok) {
        throw new UploadError(confirmResult.code);
      }

      return confirmResult;
    },
    onSuccess: () => {
      setUploadStage('done');
      toast.success('Áudio enviado. A nota ficará pronta em alguns minutos.');
      // Invalidate consent query so UI reflects any updated state
      void qc.invalidateQueries({ queryKey: [AI_CONSENT_QUERY_KEY, patientId] });
      // Reset and close
      resetState();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setUploadStage('error');
      const code = error instanceof UploadError ? error.code : undefined;

      // On PUT failure, confirmAudioUpload is SKIPPED. The row stays in
      // 'pending' status and the discard cron (24h) will clean it up.
      // This is intentional — see the uploadFileViaXhr docstring.
      if (code) {
        toast.error(getErrorMessage(code));
      } else {
        toast.error('Erro ao enviar o áudio. Tente novamente.');
      }
    },
  });

  // ---- Helpers --------------------------------------------------------------

  const resetState = useCallback(() => {
    setSelectedFile(null);
    setUploadStage('idle');
    setUploadProgress(0);
    setIsDragOver(false);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        // Only allow closing when not mid-upload
        if (uploadStage !== 'uploading' && uploadStage !== 'confirming') {
          resetState();
          onOpenChange(false);
        }
      } else {
        onOpenChange(true);
      }
    },
    [onOpenChange, resetState, uploadStage],
  );

  const handleFileSelect = useCallback((file: File) => {
    // Client-side size check (server is authoritative)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(getErrorMessage('SIZE_EXCEEDED'));
      return;
    }
    setSelectedFile(file);
    setUploadStage('idle');
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
      // Reset the input value so re-selecting the same file triggers onChange
      e.target.value = '';
    },
    [handleFileSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleConfirmUpload = useCallback(() => {
    if (!selectedFile) return;
    uploadMutation.mutate(selectedFile);
  }, [selectedFile, uploadMutation]);

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setUploadStage('idle');
    setUploadProgress(0);
  }, []);

  // ---- Derived state --------------------------------------------------------

  const isUploading =
    uploadStage === 'uploading' || uploadStage === 'confirming' || uploadStage === 'requesting-url';

  // ---- Render ---------------------------------------------------------------

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        data-testid="audio-upload-sheet"
        aria-describedby="audio-upload-description"
      >
        <SheetHeader className="px-6 pt-6">
          <SheetTitle>Enviar áudio para transcrição</SheetTitle>
          <SheetDescription id="audio-upload-description">
            Envie um arquivo de áudio da sessão para gerar a nota clínica automaticamente.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {/* Loading state */}
          {consentLoading && (
            <p className="text-text-secondary text-[13px]" data-testid="consent-loading">
              Verificando consentimento...
            </p>
          )}

          {/* Error loading consent */}
          {consentError && (
            <Alert variant="danger" data-testid="consent-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>
                Não foi possível verificar o consentimento. Tente novamente.
              </AlertDescription>
            </Alert>
          )}

          {/* Consent NOT active — show warning, no dropzone */}
          {!consentLoading && !consentError && !isConsentActive && consentData && (
            <Alert variant="warning" data-testid="consent-inactive-warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Consentimento necessário</AlertTitle>
              <AlertDescription>
                O paciente ainda não assinou o termo de transcrição por IA. Gere o termo antes de
                enviar o áudio.
              </AlertDescription>
            </Alert>
          )}

          {/* Consent IS active — show dropzone */}
          {!consentLoading && !consentError && isConsentActive && (
            <>
              {/* Dropzone (only when no file is selected) */}
              {!selectedFile && (
                <div
                  data-testid="audio-dropzone"
                  role="button"
                  tabIndex={0}
                  aria-label="Clique ou arraste um arquivo de áudio"
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
                    isDragOver
                      ? 'border-info-500 bg-info-50'
                      : 'border-border hover:border-border-strong hover:bg-surface-muted'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <Upload className="text-text-tertiary h-8 w-8" aria-hidden="true" />
                  <p className="text-text-secondary text-center text-[13px]">
                    Arraste o arquivo de áudio aqui ou clique para selecionar
                  </p>
                  <p className="text-text-tertiary text-center text-[12px]">
                    MP3, M4A, WAV ou WebM (max. 200MB)
                  </p>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_AUDIO}
                className="hidden"
                onChange={handleInputChange}
                data-testid="audio-file-input"
                aria-label="Selecionar arquivo de áudio"
              />

              {/* Selected file metadata */}
              {selectedFile && (
                <div
                  className="bg-surface-muted flex items-center gap-3 rounded-lg p-4"
                  data-testid="selected-file-info"
                >
                  <FileAudio className="text-info-500 h-8 w-8 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-text-primary truncate text-[14px] font-medium"
                      data-testid="selected-file-name"
                    >
                      {selectedFile.name}
                    </p>
                    <p className="text-text-secondary text-[12px]" data-testid="selected-file-size">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                  {!isUploading && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveFile}
                      aria-label="Remover arquivo selecionado"
                      data-testid="remove-file-btn"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}

              {/* Progress bar (visible during upload) */}
              {isUploading && (
                <div className="flex flex-col gap-2" data-testid="upload-progress-section">
                  <Progress value={uploadProgress} data-testid="upload-progress-bar" />
                  <p className="text-text-secondary text-center text-[12px]">
                    {uploadStage === 'requesting-url' && 'Preparando envio...'}
                    {uploadStage === 'uploading' && `Enviando... ${uploadProgress}%`}
                    {uploadStage === 'confirming' && 'Validando áudio...'}
                  </p>
                </div>
              )}

              {/* Action buttons */}
              {selectedFile && !isUploading && (
                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    variant="secondary"
                    onClick={handleRemoveFile}
                    data-testid="cancel-upload-btn"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleConfirmUpload}
                    disabled={uploadMutation.isPending}
                    data-testid="confirm-upload-btn"
                  >
                    Enviar áudio
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Upload error with a typed code
// ---------------------------------------------------------------------------

class UploadError extends Error {
  constructor(public readonly code: string) {
    super(getErrorMessage(code));
    this.name = 'UploadError';
  }
}
