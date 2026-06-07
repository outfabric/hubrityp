import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
//
// `useScreenShareState` returns `{ screenShare, isMute }`.
// Stream convention: isMute === false means the track is active (sharing).
// ---------------------------------------------------------------------------

const mockDisable = vi.fn().mockResolvedValue(undefined);

let mockIsMute = true;

vi.mock('@stream-io/video-react-sdk', () => ({
  useCallStateHooks: () => ({
    useScreenShareState: () => ({
      screenShare: { disable: mockDisable },
      isMute: mockIsMute,
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { ScreenShareIndicator } from '@/modules/telepsicologia/components/screen-share-indicator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset to default (not sharing)
  mockIsMute = true;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScreenShareIndicator', () => {
  it('is hidden when the user is not sharing their screen', () => {
    mockIsMute = true;

    render(<ScreenShareIndicator />);

    expect(screen.queryByTestId('screen-share-indicator')).not.toBeInTheDocument();
    expect(screen.queryByText('Você está compartilhando sua tela')).not.toBeInTheDocument();
  });

  it('is visible when the user is sharing their screen', () => {
    mockIsMute = false;

    render(<ScreenShareIndicator />);

    expect(screen.getByTestId('screen-share-indicator')).toBeInTheDocument();
    expect(screen.getByText('Você está compartilhando sua tela')).toBeInTheDocument();
    expect(screen.getByTestId('stop-screen-share-button')).toBeInTheDocument();
    expect(screen.getByText('Parar de compartilhar')).toBeInTheDocument();
  });

  it('calls screenShare.disable() when "Parar de compartilhar" is clicked', async () => {
    mockIsMute = false;
    const user = userEvent.setup();

    render(<ScreenShareIndicator />);

    const stopButton = screen.getByTestId('stop-screen-share-button');
    await user.click(stopButton);

    expect(mockDisable).toHaveBeenCalledOnce();
  });

  it('has the correct ARIA role and live region for accessibility', () => {
    mockIsMute = false;

    render(<ScreenShareIndicator />);

    const indicator = screen.getByTestId('screen-share-indicator');
    expect(indicator).toHaveAttribute('role', 'status');
    expect(indicator).toHaveAttribute('aria-live', 'polite');
  });
});
