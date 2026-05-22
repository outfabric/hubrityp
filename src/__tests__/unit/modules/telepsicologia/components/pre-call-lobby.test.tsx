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
    expect(screen.getByLabelText('Previa da camera')).toBeInTheDocument();
  });

  it('shows the camera-off placeholder when camera is muted', () => {
    mockIsCameraMuted = true;

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    expect(screen.getByText('Camera desligada')).toBeInTheDocument();
    expect(screen.queryByLabelText('Previa da camera')).not.toBeInTheDocument();
  });

  it('shows an inline permission error when camera.enable() rejects', async () => {
    mockCameraEnable.mockRejectedValueOnce(new DOMException('NotAllowedError'));

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Nao foi possivel acessar a camera. Verifique as permissoes do navegador.'),
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
        'Nao foi possivel acessar o microfone. Verifique as permissoes do navegador.',
      ),
    ).toBeInTheDocument();
  });

  it('calls call.join() when "Entrar na sessao" button is clicked', async () => {
    const user = userEvent.setup();

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    const joinButton = screen.getByTestId('join-call-button');
    expect(joinButton).toHaveTextContent('Entrar na sessao');

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

  it('shows patient waiting badge when participantCount > 0', () => {
    mockParticipantCount = 1;

    render(<PreCallLobby patient={{ id: 'p-1', fullName: 'Joana Silva' }} />);

    expect(screen.getByText('Joana Silva esta aguardando')).toBeInTheDocument();
  });
});
