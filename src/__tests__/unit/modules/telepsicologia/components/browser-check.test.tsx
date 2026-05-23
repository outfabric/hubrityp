import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { BrowserCheck } from '@/modules/telepsicologia/components/browser-check';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
//
// BrowserCheck renders children optimistically (assume supported) during SSR
// and initial render. A useEffect checks WebRTC capabilities and swaps to the
// fallback only when the browser is confirmed unsupported. Tests that assert
// the unsupported state must await the effect via waitFor.
// ---------------------------------------------------------------------------

describe('BrowserCheck', () => {
  it('renders children when WebRTC is supported', () => {
    // jsdom has `window` defined by default, but `navigator.mediaDevices`
    // and `RTCPeerConnection` may not be present. Stub them.
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn() },
    });
    vi.stubGlobal('RTCPeerConnection', vi.fn());

    render(
      <BrowserCheck>
        <div data-testid="child-content">Hello from video</div>
      </BrowserCheck>,
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Hello from video')).toBeInTheDocument();

    // The incompatible fallback must NOT be rendered
    expect(screen.queryByText('Navegador incompatível')).not.toBeInTheDocument();
  });

  it('shows incompatible message when navigator.mediaDevices is undefined', async () => {
    // Remove mediaDevices from navigator
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: undefined,
    });
    vi.stubGlobal('RTCPeerConnection', vi.fn());

    render(
      <BrowserCheck>
        <div data-testid="child-content">Hidden</div>
      </BrowserCheck>,
    );

    // After the useEffect runs, the fallback message appears
    await waitFor(() => {
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    });

    // Incompatible message must be shown with correct accents
    expect(screen.getByText('Navegador incompatível')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Seu navegador não é compatível com videochamadas. Use Chrome, Edge, Firefox ou Safari recente.',
      ),
    ).toBeInTheDocument();
  });

  it('shows incompatible message when RTCPeerConnection is undefined', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn() },
    });
    // Remove RTCPeerConnection
    vi.stubGlobal('RTCPeerConnection', undefined);

    render(
      <BrowserCheck>
        <div data-testid="child-content">Hidden</div>
      </BrowserCheck>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Navegador incompatível')).toBeInTheDocument();
  });

  it('shows incompatible message when both mediaDevices and RTCPeerConnection are undefined', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: undefined,
    });
    vi.stubGlobal('RTCPeerConnection', undefined);

    render(
      <BrowserCheck>
        <div data-testid="child-content">Hidden</div>
      </BrowserCheck>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Navegador incompatível')).toBeInTheDocument();
  });

  it('shows download links for Chrome and Firefox in the incompatible fallback', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: undefined,
    });
    vi.stubGlobal('RTCPeerConnection', undefined);

    render(
      <BrowserCheck>
        <div>Hidden</div>
      </BrowserCheck>,
    );

    // Wait for the effect to flip the state
    await waitFor(() => {
      expect(screen.getByLabelText('Baixar Google Chrome')).toBeInTheDocument();
    });

    const chromeLink = screen.getByLabelText('Baixar Google Chrome');
    expect(chromeLink).toHaveAttribute('href', 'https://www.google.com/chrome/');
    expect(chromeLink).toHaveAttribute('target', '_blank');
    expect(chromeLink).toHaveAttribute('rel', 'noopener noreferrer');

    const firefoxLink = screen.getByLabelText('Baixar Mozilla Firefox');
    expect(firefoxLink).toBeInTheDocument();
    expect(firefoxLink).toHaveAttribute('href', 'https://www.mozilla.org/pt-BR/firefox/new/');
    expect(firefoxLink).toHaveAttribute('target', '_blank');
    expect(firefoxLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
