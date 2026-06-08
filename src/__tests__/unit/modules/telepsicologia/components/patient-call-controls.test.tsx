import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
//
// The patient bar consumes only the mic + camera call-state hooks. Mutable
// module-level state drives mute state; `toggle` spies are reset per test.
// Note: the patient bar exposes NO screen-share control, so we deliberately
// do NOT provide useScreenShareState/useHasOngoingScreenShare — the component
// must not depend on them.
// ---------------------------------------------------------------------------

const mockMicToggle = vi.fn().mockResolvedValue(undefined);
const mockCameraToggle = vi.fn().mockResolvedValue(undefined);

let micIsMute = false;
let cameraIsMute = false;

vi.mock('@stream-io/video-react-sdk', () => ({
  useCallStateHooks: () => ({
    useMicrophoneState: () => ({ microphone: { toggle: mockMicToggle }, isMute: micIsMute }),
    useCameraState: () => ({ camera: { toggle: mockCameraToggle }, isMute: cameraIsMute }),
  }),
}));

// Child components not under test — inert stubs so the bar renders without
// their internal Stream / popover dependencies.
vi.mock('@/modules/telepsicologia/components/troubleshooting-popover', () => ({
  TroubleshootingPopover: () => <div data-testid="mock-troubleshooting" />,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { PatientCallControls } from '@/modules/telepsicologia/components/patient-in-call-view';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderControls() {
  return render(
    <PatientCallControls
      onLeave={vi.fn()}
      isChatOpen={false}
      onChatToggle={vi.fn()}
      hasUnreadMessages={false}
      psychologistName="Dra. Teste"
    />,
  );
}

beforeEach(() => {
  micIsMute = false;
  cameraIsMute = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PatientCallControls — device controls', () => {
  it('renders mic and camera as design-system DeviceToggleButton controls with on-state labels', () => {
    renderControls();

    // Lucide-based design-system buttons (DeviceToggleButton), not Stream widgets.
    expect(screen.getByTestId('patient-mic-toggle-button')).toBeInTheDocument();
    expect(screen.getByTestId('patient-camera-toggle-button')).toBeInTheDocument();

    // "On" state → labels offer to turn the device OFF.
    expect(screen.getByLabelText('Desligar microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Desligar câmera')).toBeInTheDocument();
  });

  it('reflects muted mic/camera state in the control labels (off variant)', () => {
    micIsMute = true;
    cameraIsMute = true;

    renderControls();

    expect(screen.getByLabelText('Ligar microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Ligar câmera')).toBeInTheDocument();
  });

  it('does not render a screen-share control', () => {
    renderControls();

    expect(screen.queryByTestId('screen-share-toggle-button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Compartilhar tela')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Parar compartilhamento de tela')).not.toBeInTheDocument();
  });

  it('preserves chat and leave testids', () => {
    renderControls();

    expect(screen.getByTestId('patient-chat-toggle-button')).toBeInTheDocument();
    expect(screen.getByTestId('patient-leave-button')).toBeInTheDocument();
  });

  it('renders the unread chat badge when there are unread messages and the chat is closed', () => {
    render(
      <PatientCallControls
        onLeave={vi.fn()}
        isChatOpen={false}
        onChatToggle={vi.fn()}
        hasUnreadMessages
        psychologistName={null}
      />,
    );

    expect(screen.getByTestId('patient-chat-unread-badge')).toBeInTheDocument();
  });

  it('toggles the microphone via the Stream hook on click', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByTestId('patient-mic-toggle-button'));

    expect(mockMicToggle).toHaveBeenCalledOnce();
  });

  it('surfaces a PT-BR permission error when the microphone toggle rejects', async () => {
    mockMicToggle.mockRejectedValueOnce(new Error('NotAllowedError'));
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByTestId('patient-mic-toggle-button'));

    await waitFor(() => {
      const alert = screen.getByTestId('patient-permission-error');
      expect(alert).toHaveTextContent(
        'Não foi possível acessar o microfone. Verifique as permissões do navegador.',
      );
    });
  });

  it('surfaces a PT-BR permission error when the camera toggle rejects', async () => {
    mockCameraToggle.mockRejectedValueOnce(new Error('NotAllowedError'));
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByTestId('patient-camera-toggle-button'));

    await waitFor(() => {
      const alert = screen.getByTestId('patient-permission-error');
      expect(alert).toHaveTextContent(
        'Não foi possível acessar a câmera. Verifique as permissões do navegador.',
      );
    });
  });

  it('clears the permission error after a successful toggle following a rejection', async () => {
    mockMicToggle.mockRejectedValueOnce(new Error('NotAllowedError'));
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByTestId('patient-mic-toggle-button'));
    await waitFor(() => {
      expect(screen.getByTestId('patient-permission-error')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('patient-mic-toggle-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('patient-permission-error')).not.toBeInTheDocument();
    });
  });
});
