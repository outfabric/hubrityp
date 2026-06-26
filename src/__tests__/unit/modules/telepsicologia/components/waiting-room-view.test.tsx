/**
 * Unit tests for the departure beacon wiring in WaitingRoomView.
 *
 * Covers the `pagehide` → `navigator.sendBeacon('/api/video/depart', ...)`
 * contract added for the waiting-room departure signal:
 *  - a `pagehide` event fires exactly one beacon to /api/video/depart with a
 *    body carrying the token;
 *  - the listener is removed on unmount (no beacon after unmount).
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
// ---------------------------------------------------------------------------

// DeviceTest requests camera/mic via getUserMedia, which is unavailable in
// jsdom. Stub it out — it is irrelevant to the beacon wiring under test.
vi.mock('@/modules/telepsicologia/components/device-test', () => ({
  DeviceTest: () => <div data-testid="device-test" />,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { WaitingRoomView } from '@/modules/telepsicologia/components/waiting-room-view';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = 'a'.repeat(64);

/** Reads the token out of the (JSON Blob) body passed to sendBeacon.
 *  Uses `FileReader` because jsdom's `Blob` implements neither `.text()` nor
 *  cross-realm reads via `Response`. */
async function readBeaconToken(body: BodyInit | null | undefined): Promise<unknown> {
  if (!(body instanceof Blob)) {
    throw new Error('expected sendBeacon body to be a Blob');
  }
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsText(body);
  });
  return (JSON.parse(text) as { token?: unknown }).token;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let sendBeacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendBeacon = vi.fn(() => true);
  vi.stubGlobal('navigator', { sendBeacon });
  // WaitingRoomView polls /api/video/join on mount; stub fetch so the poll
  // resolves to a benign waiting response and never hits the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'waiting' }),
      } as Response),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WaitingRoomView — departure beacon', () => {
  it('fires exactly one sendBeacon to /api/video/depart with the token on pagehide', async () => {
    render(
      <WaitingRoomView
        psychologistName="Dr. Beacon"
        psychologistPhotoUrl={null}
        token={TOKEN}
        onActive={vi.fn()}
      />,
    );

    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0] ?? [];
    expect(url).toBe('/api/video/depart');
    await expect(readBeaconToken(body as BodyInit)).resolves.toBe(TOKEN);
  });

  it('removes the pagehide listener on unmount (no beacon after unmount)', () => {
    const { unmount } = render(
      <WaitingRoomView
        psychologistName="Dr. Beacon"
        psychologistPhotoUrl={null}
        token={TOKEN}
        onActive={vi.fn()}
      />,
    );

    unmount();

    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
