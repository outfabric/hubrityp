import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
// ---------------------------------------------------------------------------

// Mock Stream SDK for PatientInCallView tests — provides minimal stubs
// so the component can render without real WebRTC / Stream infrastructure.
vi.mock('@stream-io/video-react-sdk', () => ({
  CallingState: { JOINED: 'joined', JOINING: 'joining', LEFT: 'left', IDLE: 'idle' },
  StreamVideo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  StreamCall: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  StreamVideoClient: vi.fn().mockImplementation(() => ({
    disconnectUser: vi.fn().mockResolvedValue(undefined),
    call: vi.fn().mockReturnValue({
      join: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnValue(vi.fn()),
    }),
  })),
  SpeakerLayout: () => <div data-testid="speaker-layout" />,
  useCall: () => ({
    leave: vi.fn(),
    on: vi.fn().mockReturnValue(vi.fn()),
    currentUserId: 'patient-test',
  }),
  useCallStateHooks: () => ({
    useCallCallingState: () => 'joined',
    useMicrophoneState: () => ({
      microphone: { toggle: vi.fn() },
      isMute: false,
    }),
    useCameraState: () => ({
      camera: { toggle: vi.fn() },
      isMute: false,
    }),
  }),
}));

// Mock child components used by PatientInCallView that are not under test
vi.mock('@/modules/telepsicologia/components/chat-drawer', () => ({
  ChatDrawer: () => <div data-testid="mock-chat-drawer" />,
}));

vi.mock('@/modules/telepsicologia/components/connection-quality-indicator', () => ({
  ConnectionQualityIndicator: () => <div data-testid="mock-connection-quality" />,
}));

vi.mock('@/modules/telepsicologia/components/troubleshooting-popover', () => ({
  TroubleshootingPopover: () => <div data-testid="mock-troubleshooting" />,
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import type { ToggleRecordingResult } from '@/modules/telepsicologia';
import { PatientInCallView } from '@/modules/telepsicologia/components/patient-in-call-view';
import { RecordingControls } from '@/modules/telepsicologia/components/recording-controls';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ROOM_ID = 'room-abc-123';

function renderControls(
  overrides: {
    roomId?: string;
    hasConsent?: boolean;
    isRecording?: boolean;
    onToggleRecording?: (input: {
      room_id: string;
      action: 'start' | 'stop';
    }) => Promise<ToggleRecordingResult>;
    onRecordingChange?: (isRecording: boolean) => void;
  } = {},
) {
  const {
    roomId = ROOM_ID,
    hasConsent = true,
    isRecording = false,
    onToggleRecording = vi.fn().mockResolvedValue({ ok: true } satisfies ToggleRecordingResult),
    onRecordingChange = vi.fn(),
  } = overrides;

  return {
    onToggleRecording,
    onRecordingChange,
    ...render(
      <RecordingControls
        roomId={roomId}
        hasConsent={hasConsent}
        isRecording={isRecording}
        onToggleRecording={onToggleRecording}
        onRecordingChange={onRecordingChange}
      />,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecordingControls', () => {
  // ---- State 1: disabled (no consent) ----

  describe('when hasConsent is false', () => {
    it('renders a disabled button with "Gravar sessao" text', () => {
      renderControls({ hasConsent: false });

      const button = screen.getByTestId('recording-button-disabled');
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Gravar sessao');
    });

    it('shows a tooltip explaining no consent', async () => {
      const user = userEvent.setup();
      renderControls({ hasConsent: false });

      // Hover over the tooltip trigger (the span wrapping the disabled button)
      const trigger = screen.getByTestId('recording-button-disabled').closest('span');
      expect(trigger).toBeTruthy();
      await user.hover(trigger!);

      await waitFor(() => {
        expect(screen.getByTestId('recording-no-consent-tooltip')).toBeInTheDocument();
      });

      // Radix Tooltip renders the text in both the visual content and an
      // accessible description span, so use getAllByText instead of getByText.
      const tooltipTexts = screen.getAllByText('Paciente nao assinou termo de gravacao');
      expect(tooltipTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('does not call onToggleRecording when clicked', async () => {
      const user = userEvent.setup();
      const onToggleRecording = vi.fn().mockResolvedValue({ ok: true });
      renderControls({ hasConsent: false, onToggleRecording });

      const button = screen.getByTestId('recording-button-disabled');
      await user.click(button);

      expect(onToggleRecording).not.toHaveBeenCalled();
    });
  });

  // ---- State 2: idle (consent valid, ready to start) ----

  describe('when hasConsent is true and isRecording is false', () => {
    it('renders "Iniciar gravacao" button', () => {
      renderControls({ hasConsent: true, isRecording: false });

      const button = screen.getByTestId('recording-start-button');
      expect(button).toBeEnabled();
      expect(button).toHaveTextContent('Iniciar gravacao');
    });

    it('calls onToggleRecording with start action when clicked', async () => {
      const user = userEvent.setup();
      const onToggleRecording = vi.fn().mockResolvedValue({ ok: true });
      renderControls({
        hasConsent: true,
        isRecording: false,
        onToggleRecording,
        roomId: 'room-xyz',
      });

      const button = screen.getByTestId('recording-start-button');
      await user.click(button);

      await waitFor(() => {
        expect(onToggleRecording).toHaveBeenCalledWith({
          room_id: 'room-xyz',
          action: 'start',
        });
      });
    });

    it('calls onRecordingChange(true) on successful start', async () => {
      const user = userEvent.setup();
      const onRecordingChange = vi.fn();
      renderControls({
        hasConsent: true,
        isRecording: false,
        onToggleRecording: vi.fn().mockResolvedValue({ ok: true }),
        onRecordingChange,
      });

      const button = screen.getByTestId('recording-start-button');
      await user.click(button);

      await waitFor(() => {
        expect(onRecordingChange).toHaveBeenCalledWith(true);
      });
    });
  });

  // ---- State 3: recording active ----

  describe('when isRecording is true', () => {
    it('shows recording indicator with red dot and "Gravando" text', () => {
      renderControls({ hasConsent: true, isRecording: true });

      expect(screen.getByTestId('recording-active-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('recording-red-dot')).toBeInTheDocument();
      expect(screen.getByText('Gravando')).toBeInTheDocument();
    });

    it('renders "Parar gravacao" button', () => {
      renderControls({ hasConsent: true, isRecording: true });

      const button = screen.getByTestId('recording-stop-button');
      expect(button).toBeEnabled();
      expect(button).toHaveTextContent('Parar gravacao');
    });

    it('calls onToggleRecording with stop action when "Parar gravacao" is clicked', async () => {
      const user = userEvent.setup();
      const onToggleRecording = vi.fn().mockResolvedValue({ ok: true });
      renderControls({
        hasConsent: true,
        isRecording: true,
        onToggleRecording,
        roomId: 'room-stop-test',
      });

      const button = screen.getByTestId('recording-stop-button');
      await user.click(button);

      await waitFor(() => {
        expect(onToggleRecording).toHaveBeenCalledWith({
          room_id: 'room-stop-test',
          action: 'stop',
        });
      });
    });

    it('calls onRecordingChange(false) on successful stop', async () => {
      const user = userEvent.setup();
      const onRecordingChange = vi.fn();
      renderControls({
        hasConsent: true,
        isRecording: true,
        onToggleRecording: vi.fn().mockResolvedValue({ ok: true }),
        onRecordingChange,
      });

      const button = screen.getByTestId('recording-stop-button');
      await user.click(button);

      await waitFor(() => {
        expect(onRecordingChange).toHaveBeenCalledWith(false);
      });
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('shows consent error when server returns CONSENT_REQUIRED', async () => {
      const user = userEvent.setup();
      const result: ToggleRecordingResult = { ok: false, code: 'CONSENT_REQUIRED' };
      renderControls({
        hasConsent: true,
        isRecording: false,
        onToggleRecording: vi.fn().mockResolvedValue(result),
      });

      const button = screen.getByTestId('recording-start-button');
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText('Consentimento de gravacao nao encontrado.')).toBeInTheDocument();
      });
    });

    it('shows generic error for unknown failures', async () => {
      const user = userEvent.setup();
      const result: ToggleRecordingResult = {
        ok: false,
        code: 'UNKNOWN',
        message: 'Erro inesperado ao alterar gravacao. Tente novamente.',
      };
      renderControls({
        hasConsent: true,
        isRecording: false,
        onToggleRecording: vi.fn().mockResolvedValue(result),
      });

      const button = screen.getByTestId('recording-start-button');
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText('Erro ao alterar gravacao. Tente novamente.')).toBeInTheDocument();
      });
    });

    it('does not call onRecordingChange when the action fails', async () => {
      const user = userEvent.setup();
      const onRecordingChange = vi.fn();
      const result: ToggleRecordingResult = { ok: false, code: 'ROOM_NOT_FOUND' };
      renderControls({
        hasConsent: true,
        isRecording: false,
        onToggleRecording: vi.fn().mockResolvedValue(result),
        onRecordingChange,
      });

      const button = screen.getByTestId('recording-start-button');
      await user.click(button);

      await waitFor(() => {
        expect(onRecordingChange).not.toHaveBeenCalled();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// PatientInCallView — recording banner tests
// ---------------------------------------------------------------------------

/**
 * Minimal JWT for the extractUserIdFromJwt helper inside PatientInCallView.
 * Payload: { user_id: "patient-test-123" }
 */
const TEST_JWT = [
  'eyJhbGciOiJIUzI1NiJ9', // header
  btoa(JSON.stringify({ user_id: 'patient-test-123' })), // payload
  'signature',
].join('.');

function renderPatientView(isRecordingActive: boolean) {
  return render(
    <PatientInCallView
      streamToken={TEST_JWT}
      apiKey="test-api-key"
      callId="call-123"
      psychologistName="Dr. Test"
      token="test-token-abc"
      onCallEnded={vi.fn()}
      isRecordingActive={isRecordingActive}
    />,
  );
}

describe('PatientInCallView — recording banner', () => {
  it('shows recording banner when isRecordingActive is true', async () => {
    renderPatientView(true);

    await waitFor(() => {
      expect(screen.getByTestId('patient-recording-banner')).toBeInTheDocument();
      expect(screen.getByText('Esta sessao esta sendo gravada')).toBeInTheDocument();
    });
  });

  it('does not show recording banner when isRecordingActive is false', async () => {
    renderPatientView(false);

    await waitFor(() => {
      expect(screen.getByTestId('speaker-layout')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('patient-recording-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('Esta sessao esta sendo gravada')).not.toBeInTheDocument();
  });
});
