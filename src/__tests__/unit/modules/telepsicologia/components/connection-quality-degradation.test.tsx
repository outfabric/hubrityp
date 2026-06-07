import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
//
// We mock both `useCallStateHooks` (for `useLocalParticipant`) and `useCall`
// (for `call.camera.selectTargetResolution`), plus Sonner's `toast`.
//
// `vi.hoisted()` ensures the variables are available at hoist time, avoiding
// "Cannot access before initialization" errors with `vi.mock` factories.
// ---------------------------------------------------------------------------

const {
  mockSelectTargetResolution,
  mockToastWarning,
  getMockConnectionQuality,
  setMockConnectionQuality,
} = vi.hoisted(() => {
  let connectionQuality: number | undefined = 0;

  return {
    mockSelectTargetResolution: vi.fn().mockResolvedValue(undefined),
    mockToastWarning: vi.fn(),
    getMockConnectionQuality: () => connectionQuality,
    setMockConnectionQuality: (q: number | undefined) => {
      connectionQuality = q;
    },
  };
});

vi.mock('@stream-io/video-react-sdk', () => ({
  useCallStateHooks: () => ({
    useLocalParticipant: () => ({
      connectionQuality: getMockConnectionQuality(),
    }),
  }),
  useCall: () => ({
    camera: {
      selectTargetResolution: mockSelectTargetResolution,
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    warning: mockToastWarning,
  },
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  ConnectionQualityIndicator,
  _resetDegradationDebounce,
} from '@/modules/telepsicologia/components/connection-quality-indicator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  _resetDegradationDebounce();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  setMockConnectionQuality(0);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionQualityIndicator — degradation controls', () => {
  it('shows a warning toast when connection quality drops to poor', () => {
    setMockConnectionQuality(1); // POOR

    render(<ConnectionQualityIndicator />);

    expect(mockToastWarning).toHaveBeenCalledOnce();
    expect(mockToastWarning).toHaveBeenCalledWith(
      'Sua conexão está instável',
      expect.objectContaining({
        action: expect.objectContaining({
          label: 'Reduzir qualidade',
        }),
      }),
    );
  });

  it('does not show toast when quality is good or excellent', () => {
    setMockConnectionQuality(2); // GOOD

    render(<ConnectionQualityIndicator />);

    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it('does not show toast when quality is unspecified', () => {
    setMockConnectionQuality(0); // UNSPECIFIED

    render(<ConnectionQualityIndicator />);

    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it('"Reduzir qualidade" action calls selectTargetResolution with 320x240', () => {
    setMockConnectionQuality(1); // POOR

    render(<ConnectionQualityIndicator />);

    // Extract the action onClick handler from the toast call
    const toastCallArgs = mockToastWarning.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    const actionOnClick = toastCallArgs[1].action.onClick;

    actionOnClick();

    expect(mockSelectTargetResolution).toHaveBeenCalledOnce();
    expect(mockSelectTargetResolution).toHaveBeenCalledWith({ width: 320, height: 240 });
  });

  it('does not repeat the toast within the 30s debounce window', () => {
    setMockConnectionQuality(1); // POOR

    const { unmount } = render(<ConnectionQualityIndicator />);
    expect(mockToastWarning).toHaveBeenCalledOnce();

    unmount();

    // Advance only 10s — within the 30s debounce window
    vi.advanceTimersByTime(10_000);

    // Re-render with poor quality — toast should NOT fire again
    render(<ConnectionQualityIndicator />);

    expect(mockToastWarning).toHaveBeenCalledOnce(); // Still only 1 call total
  });

  it('shows the toast again after the 30s debounce window expires', () => {
    setMockConnectionQuality(1); // POOR

    const { unmount } = render(<ConnectionQualityIndicator />);
    expect(mockToastWarning).toHaveBeenCalledOnce();

    unmount();

    // Advance past the 30s debounce window
    vi.advanceTimersByTime(31_000);

    // Re-render with poor quality — toast should fire again
    render(<ConnectionQualityIndicator />);

    expect(mockToastWarning).toHaveBeenCalledTimes(2);
  });

  it('still renders the instability banner alongside the toast', () => {
    setMockConnectionQuality(1); // POOR

    render(<ConnectionQualityIndicator />);

    // The banner should still be visible
    expect(screen.getByRole('alert')).toHaveTextContent('Sua conexão está instável');
    // And the toast should have been fired
    expect(mockToastWarning).toHaveBeenCalledOnce();
  });
});
