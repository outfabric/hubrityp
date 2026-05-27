'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/shared/ui/button';

import type { ConfirmAudioUploadResult, RequestAudioUploadUrlResult } from '../server';

import { AudioUploadSheet } from './audio-upload-sheet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface AudioUploadButtonProps {
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
// Query client factory — each button gets an isolated cache, same pattern
// as AiConsentPanel. React's useState initialiser runs once.
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AudioUploadButton({
  patientId,
  sessionId = null,
  getConsentStatusAction,
  requestUploadUrlAction,
  confirmUploadAction,
}: AudioUploadButtonProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [client] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={client}>
      <Button variant="secondary" onClick={() => setSheetOpen(true)} data-testid="audio-upload-btn">
        <Upload className="h-4 w-4" aria-hidden="true" />
        Enviar audio para transcricao
      </Button>

      <AudioUploadSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        patientId={patientId}
        sessionId={sessionId}
        getConsentStatusAction={getConsentStatusAction}
        requestUploadUrlAction={requestUploadUrlAction}
        confirmUploadAction={confirmUploadAction}
      />
    </QueryClientProvider>
  );
}
