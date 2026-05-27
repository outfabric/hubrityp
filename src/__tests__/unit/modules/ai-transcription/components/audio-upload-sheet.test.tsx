import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import * as vitestAxeMatchers from 'vitest-axe/matchers';

// Extend Vitest's expect with vitest-axe matchers for toHaveNoViolations()
expect.extend(vitestAxeMatchers);

// Augment vitest's Assertion interface so TypeScript recognizes the matcher
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation for vitest-axe matchers
  interface Assertion extends vitestAxeMatchers.AxeMatchers {}
}

import { AudioUploadSheet } from '@/modules/ai-transcription/components/audio-upload-sheet';
import type { TranscriptionId } from '@/modules/ai-transcription/lib/branded-types';
import type {
  ConfirmAudioUploadResult,
  RequestAudioUploadUrlResult,
} from '@/modules/ai-transcription/server';

// ---------------------------------------------------------------------------
// Mock sonner so toasts are observable without a Toaster provider
// ---------------------------------------------------------------------------

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock XMLHttpRequest for upload progress tests
// ---------------------------------------------------------------------------

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  readyState = 0;
  response = '';

  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn();

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  /** Simulate a successful upload. */
  simulateSuccess(status = 200) {
    this.status = status;
    this.onload?.();
  }

  /** Simulate a network error. */
  simulateError() {
    this.onerror?.();
  }

  /** Simulate upload progress. */
  simulateProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const TRANSCRIPTION_ID = '33333333-3333-3333-3333-333333333333';

function makeAudioFile(name = 'test-session.mp3', sizeBytes = 1024 * 1024): File {
  const buffer = new ArrayBuffer(sizeBytes);
  return new File([buffer], name, { type: 'audio/mpeg' });
}

// ---------------------------------------------------------------------------
// Mock action factories
// ---------------------------------------------------------------------------

type ConsentState = 'none' | 'pending' | 'active' | 'revoked';
type ConsentStatusFn = (
  patientId: string,
) => Promise<{ ok: true; consent: { state: ConsentState } } | { ok: false }>;
type RequestUrlFn = (input: {
  patientId: string;
  sessionId: string | null;
  contentType: string;
  sizeBytes: number;
}) => Promise<RequestAudioUploadUrlResult>;
type ConfirmFn = (input: {
  transcriptionId: string;
  audioDurationSeconds: number | null;
}) => Promise<ConfirmAudioUploadResult>;

function makeConsentAction(state: ConsentState = 'active'): ConsentStatusFn {
  return vi.fn<ConsentStatusFn>().mockResolvedValue({
    ok: true as const,
    consent: { state },
  });
}

function makeRequestUrlAction(
  result: RequestAudioUploadUrlResult = {
    ok: true,
    transcriptionId: TRANSCRIPTION_ID as TranscriptionId,
    uploadUrl: 'https://storage.example.com/upload/signed',
    expiresAt: new Date(Date.now() + 300_000),
    objectKey: `user-id/${TRANSCRIPTION_ID}.mp3`,
  },
): RequestUrlFn {
  return vi.fn<RequestUrlFn>().mockResolvedValue(result);
}

function makeConfirmAction(
  result: ConfirmAudioUploadResult = {
    ok: true,
    transcriptionId: TRANSCRIPTION_ID as TranscriptionId,
  },
): ConfirmFn {
  return vi.fn<ConfirmFn>().mockResolvedValue(result);
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderOpts {
  open?: boolean;
  consentState?: 'none' | 'pending' | 'active' | 'revoked';
  requestUrlResult?: RequestAudioUploadUrlResult;
  confirmResult?: ConfirmAudioUploadResult;
  sessionId?: string | null;
  onOpenChange?: (open: boolean) => void;
}

function renderSheet(opts: RenderOpts = {}) {
  const {
    open = true,
    consentState = 'active',
    requestUrlResult,
    confirmResult,
    sessionId = null,
    onOpenChange = vi.fn(),
  } = opts;

  const getConsentStatusAction = makeConsentAction(consentState);
  const requestUploadUrlAction = makeRequestUrlAction(requestUrlResult);
  const confirmUploadAction = makeConfirmAction(confirmResult);

  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={client}>
      <AudioUploadSheet
        open={open}
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        sessionId={sessionId}
        getConsentStatusAction={getConsentStatusAction}
        requestUploadUrlAction={requestUploadUrlAction}
        confirmUploadAction={confirmUploadAction}
      />
    </QueryClientProvider>,
  );

  return {
    ...result,
    onOpenChange,
    getConsentStatusAction,
    requestUploadUrlAction,
    confirmUploadAction,
    client,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockXMLHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioUploadSheet', () => {
  // (a) consent inactive -> no dropzone, warning rendered
  describe('when consent is NOT active', () => {
    it.each<'none' | 'pending' | 'revoked'>(['none', 'pending', 'revoked'])(
      'shows a warning alert and no dropzone when consent state is "%s"',
      async (state) => {
        renderSheet({ consentState: state });

        await waitFor(() => {
          expect(screen.getByTestId('consent-inactive-warning')).toBeInTheDocument();
        });

        expect(screen.queryByTestId('audio-dropzone')).not.toBeInTheDocument();
        expect(screen.queryByTestId('audio-file-input')).not.toBeInTheDocument();
      },
    );

    it('displays the correct warning message', async () => {
      renderSheet({ consentState: 'none' });

      await waitFor(() => {
        expect(screen.getByTestId('consent-inactive-warning')).toBeInTheDocument();
      });

      expect(
        screen.getByText(/O paciente ainda não assinou o termo de transcrição por IA/),
      ).toBeInTheDocument();
    });
  });

  // (b) consent active -> dropzone visible
  describe('when consent IS active', () => {
    it('shows the dropzone and file input', async () => {
      renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      expect(screen.getByTestId('audio-file-input')).toBeInTheDocument();
      expect(screen.queryByTestId('consent-inactive-warning')).not.toBeInTheDocument();
    });
  });

  // (c) selecting a file shows metadata
  describe('file selection', () => {
    it('displays file name and size when a file is selected', async () => {
      renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile('minha-sessao.mp3', 5 * 1024 * 1024);
      const input = screen.getByTestId('audio-file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('selected-file-info')).toBeInTheDocument();
      });

      expect(screen.getByTestId('selected-file-name')).toHaveTextContent('minha-sessao.mp3');
      expect(screen.getByTestId('selected-file-size')).toHaveTextContent('5.0 MB');
    });

    it('hides the dropzone when a file is selected', async () => {
      renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile();
      const input = screen.getByTestId('audio-file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('selected-file-info')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('audio-dropzone')).not.toBeInTheDocument();
    });

    it('shows confirm and cancel buttons after file selection', async () => {
      renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile();
      await userEvent.upload(screen.getByTestId('audio-file-input'), file);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-upload-btn')).toBeInTheDocument();
      });

      expect(screen.getByTestId('cancel-upload-btn')).toBeInTheDocument();
    });

    it('removes the file when cancel is clicked', async () => {
      renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile();
      await userEvent.upload(screen.getByTestId('audio-file-input'), file);

      await waitFor(() => {
        expect(screen.getByTestId('selected-file-info')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('cancel-upload-btn'));

      await waitFor(() => {
        expect(screen.queryByTestId('selected-file-info')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
    });
  });

  // (d) confirm calls the actions in the right order
  describe('upload flow', () => {
    it('calls requestUploadUrl then XHR PUT then confirmUpload on success', async () => {
      const requestUploadUrlAction = makeRequestUrlAction();
      const confirmUploadAction = makeConfirmAction();
      const onOpenChange = vi.fn();

      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 0 },
          mutations: { retry: false },
        },
      });

      render(
        <QueryClientProvider client={client}>
          <AudioUploadSheet
            open
            onOpenChange={onOpenChange}
            patientId={PATIENT_ID}
            sessionId={SESSION_ID}
            getConsentStatusAction={makeConsentAction('active')}
            requestUploadUrlAction={requestUploadUrlAction}
            confirmUploadAction={confirmUploadAction}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile('session-audio.mp3', 2 * 1024 * 1024);
      await userEvent.upload(screen.getByTestId('audio-file-input'), file);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-upload-btn')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('confirm-upload-btn'));

      // Step 1: requestUploadUrl should be called with the correct params
      await waitFor(() => {
        expect(requestUploadUrlAction).toHaveBeenCalledWith({
          patientId: PATIENT_ID,
          sessionId: SESSION_ID,
          contentType: 'audio/mpeg',
          sizeBytes: 2 * 1024 * 1024,
        });
      });

      // Step 2: XHR PUT should have been created
      await waitFor(() => {
        expect(MockXMLHttpRequest.instances.length).toBeGreaterThanOrEqual(1);
      });

      const xhr = MockXMLHttpRequest.instances[MockXMLHttpRequest.instances.length - 1]!;
      expect(xhr.open).toHaveBeenCalledWith(
        'PUT',
        'https://storage.example.com/upload/signed',
        true,
      );

      // Simulate successful upload
      xhr.simulateSuccess(200);

      // Step 3: confirmUpload should be called
      await waitFor(() => {
        expect(confirmUploadAction).toHaveBeenCalledWith({
          transcriptionId: TRANSCRIPTION_ID,
          audioDurationSeconds: null,
        });
      });

      // Verify success toast
      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          'Áudio enviado. A nota ficará pronta em alguns minutos.',
        );
      });

      // Verify sheet closed
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // (e) PUT failure -> error toast
  describe('error handling', () => {
    it('shows error toast when requestUploadUrl fails', async () => {
      const requestUrlResult: RequestAudioUploadUrlResult = {
        ok: false,
        code: 'CONSENT_INACTIVE',
      };

      renderSheet({ consentState: 'active', requestUrlResult });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile();
      await userEvent.upload(screen.getByTestId('audio-file-input'), file);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-upload-btn')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('confirm-upload-btn'));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          'O paciente ainda não assinou o termo de transcrição por IA.',
        );
      });
    });

    it('shows error toast when XHR PUT fails', async () => {
      renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile();
      await userEvent.upload(screen.getByTestId('audio-file-input'), file);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-upload-btn')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('confirm-upload-btn'));

      // Wait for XHR to be created
      await waitFor(() => {
        expect(MockXMLHttpRequest.instances.length).toBeGreaterThanOrEqual(1);
      });

      // Simulate failure
      const xhr = MockXMLHttpRequest.instances[MockXMLHttpRequest.instances.length - 1]!;
      xhr.simulateError();

      // On PUT failure, confirmAudioUpload is NOT called. The row stays
      // in 'pending' status and the discard cron (24h) will clean it up.
      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Erro ao enviar o áudio. Tente novamente.');
      });
    });

    it('does NOT call confirmUpload when PUT fails', async () => {
      const confirmUploadAction = makeConfirmAction();

      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 0 },
          mutations: { retry: false },
        },
      });

      render(
        <QueryClientProvider client={client}>
          <AudioUploadSheet
            open
            onOpenChange={vi.fn()}
            patientId={PATIENT_ID}
            getConsentStatusAction={makeConsentAction('active')}
            requestUploadUrlAction={makeRequestUrlAction()}
            confirmUploadAction={confirmUploadAction}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile();
      await userEvent.upload(screen.getByTestId('audio-file-input'), file);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-upload-btn')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('confirm-upload-btn'));

      await waitFor(() => {
        expect(MockXMLHttpRequest.instances.length).toBeGreaterThanOrEqual(1);
      });

      const xhr = MockXMLHttpRequest.instances[MockXMLHttpRequest.instances.length - 1]!;
      xhr.simulateError();

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalled();
      });

      // confirmUpload should NEVER have been called
      expect(confirmUploadAction).not.toHaveBeenCalled();
    });

    it('shows specific error message for each error code', async () => {
      const errorCodes: Array<{ code: string; expectedMsg: string }> = [
        { code: 'SIZE_EXCEEDED', expectedMsg: 'Tamanho excedido (max. 200MB).' },
        {
          code: 'CONTENT_TYPE_NOT_ALLOWED',
          expectedMsg: 'Tipo de arquivo não suportado. Envie MP3, M4A, WAV ou WebM.',
        },
        {
          code: 'RATE_LIMITED',
          expectedMsg: 'Muitas tentativas. Aguarde um minuto e tente novamente.',
        },
        { code: 'UNAUTHORIZED', expectedMsg: 'Você precisa estar logado para enviar áudios.' },
      ];

      for (const { code, expectedMsg } of errorCodes) {
        cleanup();
        vi.clearAllMocks();
        MockXMLHttpRequest.instances = [];

        renderSheet({
          consentState: 'active',
          requestUrlResult: { ok: false, code } as RequestAudioUploadUrlResult,
        });

        await waitFor(() => {
          expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
        });

        const file = makeAudioFile();
        await userEvent.upload(screen.getByTestId('audio-file-input'), file);

        await waitFor(() => {
          expect(screen.getByTestId('confirm-upload-btn')).toBeInTheDocument();
        });

        await userEvent.click(screen.getByTestId('confirm-upload-btn'));

        await waitFor(() => {
          expect(mockToastError).toHaveBeenCalledWith(expectedMsg);
        });
      }
    });
  });

  // (f) success -> success toast and sheet closes
  describe('success flow', () => {
    it('shows success toast and closes sheet on successful upload', async () => {
      const onOpenChange = vi.fn();

      renderSheet({ consentState: 'active', onOpenChange });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const file = makeAudioFile();
      await userEvent.upload(screen.getByTestId('audio-file-input'), file);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-upload-btn')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('confirm-upload-btn'));

      await waitFor(() => {
        expect(MockXMLHttpRequest.instances.length).toBeGreaterThanOrEqual(1);
      });

      const xhr = MockXMLHttpRequest.instances[MockXMLHttpRequest.instances.length - 1]!;
      xhr.simulateSuccess(200);

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          'Áudio enviado. A nota ficará pronta em alguns minutos.',
        );
      });

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // (g) keyboard nav passes axe-core
  describe('accessibility', () => {
    it('passes axe-core checks with consent active and dropzone visible', async () => {
      const { container } = renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe-core checks with consent inactive warning', async () => {
      const { container } = renderSheet({ consentState: 'none' });

      await waitFor(() => {
        expect(screen.getByTestId('consent-inactive-warning')).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('dropzone is keyboard accessible', async () => {
      renderSheet({ consentState: 'active' });

      await waitFor(() => {
        expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
      });

      const dropzone = screen.getByTestId('audio-dropzone');
      expect(dropzone).toHaveAttribute('tabIndex', '0');
      expect(dropzone).toHaveAttribute('role', 'button');
      expect(dropzone).toHaveAttribute('aria-label');
    });
  });
});
