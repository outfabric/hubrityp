import { cleanup, render, screen } from '@testing-library/react';
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
    expect(screen.queryByText('Navegador incompativel')).not.toBeInTheDocument();
  });

  it('shows incompatible message when navigator.mediaDevices is undefined', () => {
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

    // Children must NOT be rendered
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();

    // Incompatible message must be shown
    expect(screen.getByText('Navegador incompativel')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Seu navegador nao e compativel com videochamadas. Use Chrome, Edge, Firefox ou Safari recente.',
      ),
    ).toBeInTheDocument();
  });

  it('shows incompatible message when RTCPeerConnection is undefined', () => {
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

    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    expect(screen.getByText('Navegador incompativel')).toBeInTheDocument();
  });

  it('shows incompatible message when both mediaDevices and RTCPeerConnection are undefined', () => {
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

    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    expect(screen.getByText('Navegador incompativel')).toBeInTheDocument();
  });

  it('shows download links for Chrome and Firefox in the incompatible fallback', () => {
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

    const chromeLink = screen.getByLabelText('Baixar Google Chrome');
    expect(chromeLink).toBeInTheDocument();
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
