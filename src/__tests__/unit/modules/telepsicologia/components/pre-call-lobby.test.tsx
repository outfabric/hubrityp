import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
// ---------------------------------------------------------------------------

const mockJoin = vi.fn().mockResolvedValue(undefined);
const mockCameraEnable = vi.fn().mockResolvedValue(undefined);
const mockCameraToggle = vi.fn().mockResolvedValue(undefined);
const mockMicEnable = vi.fn().mockResolvedValue(undefined);
const mockMicToggle = vi.fn().mockResolvedValue(undefined);

const mockCall = { join: mockJoin };

let mockIsCameraMuted = false;
let mockIsMicMuted = false;
let mockCameraStream: MediaStream | null = null;
let mockMicStream: MediaStream | null = null;
let mockParticipantCount = 0;

vi.mock('@stream-io/video-react-sdk', () => ({
  useCall: () => mockCall,
  useCallStateHooks: () => ({
    useCameraState: () => ({
      camera: { enable: mockCameraEnable, toggle: mockCameraToggle },
      mediaStream: mockCameraStream,
      isMute: mockIsCameraMuted,
    }),
    useMicrophoneState: () => ({
      microphone: { enable: mockMicEnable, toggle: mockMicToggle },
      isMute: mockIsMicMuted,
      mediaStream: mockMicStream,
    }),
    useParticipantCount: () => mockParticipantCount,
  }),
}));

// Mock Web Audio API used by the mic level indicator
const mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => arr.fill(0));
vi.stubGlobal(
  'AudioContext',
  vi.fn().mockImplementation(() => ({
    createMediaStreamSource: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createAnalyser: vi.fn().mockReturnValue({
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: mockGetByteFrequencyData,
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
);

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { PreCallLobby } from '@/modules/telepsicologia/components/pre-call-lobby';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset mutable mock state
  mockIsCameraMuted = false;
  mockIsMicMuted = false;
  mockCameraStream = null;
  mockMicStream = null;
  mockParticipantCount = 0;
});

// Suppress "Not implemented: HTMLMediaElement.prototype.play" warnings from
// jsdom for the <video> element. These are expected in a test environment.
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreCallLobby', () => {
  it('renders the camera preview video element', () => {
    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    // Camera preview is a <video> element with the aria-label
    expect(screen.getByLabelText('Prévia da câmera')).toBeInTheDocument();
  });

  it('shows the camera-off placeholder when camera is muted', () => {
    mockIsCameraMuted = true;

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    expect(screen.getByText('Câmera desligada')).toBeInTheDocument();
    expect(screen.queryByLabelText('Prévia da câmera')).not.toBeInTheDocument();
  });

  it('shows an inline permission error when camera.enable() rejects', async () => {
    mockCameraEnable.mockRejectedValueOnce(new DOMException('NotAllowedError'));

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Não foi possível acessar a câmera. Verifique as permissões do navegador.'),
    ).toBeInTheDocument();
  });

  it('shows an inline permission error when microphone.enable() rejects', async () => {
    mockMicEnable.mockRejectedValueOnce(new DOMException('NotAllowedError'));

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        'Não foi possível acessar o microfone. Verifique as permissões do navegador.',
      ),
    ).toBeInTheDocument();
  });

  it('calls call.join() when "Entrar na sessão" button is clicked', async () => {
    const user = userEvent.setup();

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    const joinButton = screen.getByTestId('join-call-button');
    expect(joinButton).toHaveTextContent('Entrar na sessão');

    await user.click(joinButton);

    expect(mockJoin).toHaveBeenCalledOnce();
  });

  it('shows "Entrando..." and disables button while joining', async () => {
    const user = userEvent.setup();
    // Make join hang so we can observe the loading state
    let resolveJoin: () => void;
    mockJoin.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveJoin = resolve;
      }),
    );

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    const joinButton = screen.getByTestId('join-call-button');
    await user.click(joinButton);

    await waitFor(() => {
      expect(joinButton).toHaveTextContent('Entrando...');
      expect(joinButton).toBeDisabled();
    });

    // Resolve and verify we go back to normal
    resolveJoin!();
  });

  it('logs the actual Stream error with the [telepsicologia] prefix when call.join() rejects', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const joinError = new Error('Stream connection refused');
    mockJoin.mockRejectedValueOnce(joinError);

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await user.click(screen.getByTestId('join-call-button'));

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('[telepsicologia] call.join failed', joinError);
    });

    consoleErrorSpy.mockRestore();
  });

  it('shows patient waiting badge when participantCount > 0', () => {
    mockParticipantCount = 1;

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    expect(screen.getByText('Joana Silva está aguardando')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // DeviceToggleButton integration (rule-of-three extraction)
  //
  // After Section 5, the lobby renders mic/camera via the shared
  // DeviceToggleButton. These assertions pin the contract: stable testids,
  // ghost variant when the device is on, outline when off, and the existing
  // toggle().catch permission handling still surfaces an inline error.
  // -------------------------------------------------------------------------

  it('renders mic and camera as DeviceToggleButton with stable testids', () => {
    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    expect(screen.getByTestId('mic-toggle-button')).toBeInTheDocument();
    expect(screen.getByTestId('camera-toggle-button')).toBeInTheDocument();
  });

  it('uses the ghost variant for mic/camera when devices are on', () => {
    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    const mic = screen.getByTestId('mic-toggle-button');
    const camera = screen.getByTestId('camera-toggle-button');

    // DeviceToggleButton maps isOff=false -> variant "ghost" (no border, unlike outline)
    expect(mic).not.toHaveClass('border-border-strong');
    expect(camera).not.toHaveClass('border-border-strong');
    // On-state label + accessible name
    expect(mic).toHaveAccessibleName('Desligar microfone');
    expect(camera).toHaveAccessibleName('Desligar câmera');
  });

  it('uses the outline variant for mic/camera when devices are muted', () => {
    mockIsMicMuted = true;
    mockIsCameraMuted = true;

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    const mic = screen.getByTestId('mic-toggle-button');
    const camera = screen.getByTestId('camera-toggle-button');

    // DeviceToggleButton maps isOff=true -> variant "outline" (has border-border-strong)
    expect(mic).toHaveClass('border-border-strong');
    expect(camera).toHaveClass('border-border-strong');
    // Off-state label + accessible name
    expect(mic).toHaveAccessibleName('Ligar microfone');
    expect(camera).toHaveAccessibleName('Ligar câmera');
  });

  it('toggles the mic via the shared button', async () => {
    const user = userEvent.setup();

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await user.click(screen.getByTestId('mic-toggle-button'));

    expect(mockMicToggle).toHaveBeenCalledOnce();
  });

  it('toggles the camera via the shared button', async () => {
    const user = userEvent.setup();

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await user.click(screen.getByTestId('camera-toggle-button'));

    expect(mockCameraToggle).toHaveBeenCalledOnce();
  });

  it('surfaces a permission error when microphone.toggle() rejects', async () => {
    const user = userEvent.setup();
    mockMicToggle.mockRejectedValueOnce(new DOMException('NotAllowedError'));

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await user.click(screen.getByTestId('mic-toggle-button'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Não foi possível acessar o microfone. Verifique as permissões do navegador.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('surfaces a permission error when camera.toggle() rejects', async () => {
    const user = userEvent.setup();
    mockCameraToggle.mockRejectedValueOnce(new DOMException('NotAllowedError'));

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await user.click(screen.getByTestId('camera-toggle-button'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Não foi possível acessar a câmera. Verifique as permissões do navegador.',
        ),
      ).toBeInTheDocument();
    });
  });
});
