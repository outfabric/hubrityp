import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
//
// Mutable module-level state lets each test drive the Stream call-state hooks
// (mic/camera mute, screen-share status, ongoing screen share) and assert how
// the design-system controls react. `toggle` spies are reset per test.
// ---------------------------------------------------------------------------

const mockMicToggle = vi.fn().mockResolvedValue(undefined);
const mockCameraToggle = vi.fn().mockResolvedValue(undefined);
const mockScreenShareToggle = vi.fn().mockResolvedValue(undefined);

let micIsMute = false;
let cameraIsMute = false;
let screenShareStatus: 'enabled' | 'disabled' = 'disabled';
let hasOngoingScreenShare = false;

vi.mock('@stream-io/video-react-sdk', () => ({
  useCallStateHooks: () => ({
    useMicrophoneState: () => ({ microphone: { toggle: mockMicToggle }, isMute: micIsMute }),
    useCameraState: () => ({ camera: { toggle: mockCameraToggle }, isMute: cameraIsMute }),
    useScreenShareState: () => ({
      screenShare: { toggle: mockScreenShareToggle },
      status: screenShareStatus,
    }),
    useHasOngoingScreenShare: () => hasOngoingScreenShare,
  }),
}));

// Child components not under test — replaced with inert stubs so the bar can
// render without their internal Stream / dialog dependencies.
vi.mock('@/modules/telepsicologia/components/recording-controls', () => ({
  RecordingControls: () => <div data-testid="mock-recording-controls" />,
}));

vi.mock('@/modules/telepsicologia/components/troubleshooting-popover', () => ({
  TroubleshootingPopover: () => <div data-testid="mock-troubleshooting" />,
}));

vi.mock('@/modules/telepsicologia/components/end-call-dialog', () => ({
  EndCallDialog: () => <div data-testid="mock-end-call-dialog" />,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { CallControlBar } from '@/modules/telepsicologia/components/call-control-bar';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const room = { id: 'room-1' } as VideoRoom;

function renderBar() {
  return render(
    <CallControlBar
      room={room}
      onEndSession={vi.fn().mockResolvedValue({ ok: true })}
      isChatOpen={false}
      onChatToggle={vi.fn()}
      hasUnreadMessages={false}
      isPsychologist
    />,
  );
}

beforeEach(() => {
  micIsMute = false;
  cameraIsMute = false;
  screenShareStatus = 'disabled';
  hasOngoingScreenShare = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CallControlBar — device controls', () => {
  it('renders mic/camera/screen-share as design-system controls with on-state labels', () => {
    renderBar();

    // Lucide-based design-system buttons (DeviceToggleButton), not Stream widgets.
    expect(screen.getByTestId('mic-toggle-button')).toBeInTheDocument();
    expect(screen.getByTestId('camera-toggle-button')).toBeInTheDocument();
    expect(screen.getByTestId('screen-share-toggle-button')).toBeInTheDocument();

    // "On" state → labels offer to turn the device OFF.
    expect(screen.getByLabelText('Desligar microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Desligar câmera')).toBeInTheDocument();
    expect(screen.getByLabelText('Compartilhar tela')).toBeInTheDocument();
  });

  it('reflects muted mic/camera state in the control labels (off variant)', () => {
    micIsMute = true;
    cameraIsMute = true;

    renderBar();

    expect(screen.getByLabelText('Ligar microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Ligar câmera')).toBeInTheDocument();
  });

  it('shows the active screen-share label when status is "enabled"', () => {
    screenShareStatus = 'enabled';

    renderBar();

    expect(screen.getByLabelText('Parar compartilhamento de tela')).toBeInTheDocument();
  });

  it('disables the screen-share button when another participant is sharing and the user is not', () => {
    screenShareStatus = 'disabled';
    hasOngoingScreenShare = true;

    renderBar();

    expect(screen.getByTestId('screen-share-toggle-button')).toBeDisabled();
  });

  it('keeps the screen-share button enabled when the user is the one sharing', () => {
    screenShareStatus = 'enabled';
    hasOngoingScreenShare = true;

    renderBar();

    expect(screen.getByTestId('screen-share-toggle-button')).not.toBeDisabled();
  });

  it('toggles the microphone via the Stream hook on click', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByTestId('mic-toggle-button'));

    expect(mockMicToggle).toHaveBeenCalledOnce();
  });

  it('surfaces a PT-BR permission error when the microphone toggle rejects', async () => {
    mockMicToggle.mockRejectedValueOnce(new Error('NotAllowedError'));
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByTestId('mic-toggle-button'));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(
        'Não foi possível acessar o microfone. Verifique as permissões do navegador.',
      );
    });
  });

  it('surfaces a PT-BR permission error when the screen-share toggle rejects', async () => {
    mockScreenShareToggle.mockRejectedValueOnce(new Error('NotAllowedError'));
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByTestId('screen-share-toggle-button'));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(
        'Não foi possível compartilhar a tela. Verifique as permissões do navegador.',
      );
    });
  });

  it('preserves the chat and end-call testids', () => {
    renderBar();

    expect(screen.getByTestId('chat-toggle-button')).toBeInTheDocument();
    expect(screen.getByTestId('end-call-button')).toBeInTheDocument();
  });
});
